/**
 * AI Gateway — Provider-Agnostic 層
 *
 * 底層統一指向 OpenRouter，可隨時換成任何相容 provider。
 * 模型優先級：主模型失敗自動降級，不影響上層業務邏輯。
 * 降級規則見 docs/QUERY_AGENT_PHASE0.md §4.5。
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, generateObject, APICallError, NoSuchToolError, type ToolCallRepairFunction, type ToolSet } from "ai";
import type { LanguageModelV1 } from "@ai-sdk/provider";
import { normalizeToolName, type QueryRun } from "./observer.js";

// 模型優先級清單（由上往下降級）
export const MODEL_PRIORITY = [
  "google/gemini-2.5-flash-lite",       // 主力：快、便宜
  "google/gemini-2.5-flash",            // 降級 1：同家族
  "anthropic/claude-haiku-4.5",         // 降級 2：不同 provider（OpenRouter ID 格式）
] as const;

/** Upper bound for one model attempt; the request deadline can cut it shorter. */
const ATTEMPT_TIMEOUT_MS = 30_000;

export interface GatewayModel {
  id: string;
  model: LanguageModelV1;
}

/** OpenRouter models in the given order (evals use this to try another primary model). */
export function modelsFor(ids: readonly string[]): GatewayModel[] {
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
  return ids.map((id) => ({ id, model: openrouter(id) as unknown as LanguageModelV1 }));
}

let defaultModels: GatewayModel[] | null = null;
function getDefaultModels(): GatewayModel[] {
  defaultModels ??= modelsFor(MODEL_PRIORITY);
  return defaultModels;
}

export interface GatewayCall extends QueryRun {
  /** Trace label: "router" or "agent:<group>". */
  phase: string;
  /** Called when an attempt fails, before the next model is tried — discard that attempt's drafts. */
  onAttemptFailed?: () => void;
  /** Checks a finished text reply; returning a reason rejects it and falls back to the next model. */
  validate?: (text: string) => string | null;
  /** Text to use when the model finished with no text but the attempt still did its job. */
  emptyReply?: () => string | null;
  attemptTimeoutMs?: number;
}

/** The model finished without any text (e.g. Gemini MALFORMED_FUNCTION_CALL) — F8. */
export class EmptyResponseError extends Error {
  constructor(readonly finishReason: string) {
    super(`Model returned an empty response (finishReason: ${finishReason})`);
    this.name = "EmptyResponseError";
  }
}

/** The reply broke a rule the caller checks (GatewayCall.validate), e.g. claiming a draft that doesn't exist. */
export class InvalidReplyError extends Error {
  constructor(reason: string) {
    super(`Invalid reply: ${reason}`);
    this.name = "InvalidReplyError";
  }
}

export class DeadlineExceededError extends Error {
  constructor() {
    super("Query deadline exceeded");
    this.name = "DeadlineExceededError";
  }
}

// OpenRouter's error message is often just the HTTP status text ("Bad Request");
// the actual reason (e.g. an invalid model ID) lives in the response body.
export function describeError(err: unknown): string {
  const e = err as { message?: string; responseBody?: unknown } | null;
  const body = typeof e?.responseBody === "string" ? ` — ${e.responseBody.slice(0, 500)}` : "";
  return `${e?.message ?? String(err)}${body}`;
}

/**
 * Whether another model is worth trying. Model-specific failures (empty or malformed output,
 * provider errors, rate limits, timeouts, a model ID one provider rejects) fall back; failures
 * every model would hit do not.
 */
function shouldFallBack(err: unknown): boolean {
  if (err instanceof DeadlineExceededError) return false;
  // A tool the model doesn't have even after repair: a prompt/tool design bug (see F3).
  if (NoSuchToolError.isInstance(err)) return false;
  // Same API key for every model.
  if (APICallError.isInstance(err) && (err.statusCode === 401 || err.statusCode === 403)) return false;
  return true;
}

/** Gemini sometimes calls `default_api.<tool>`; map it back instead of registering aliases (F4). */
const repairToolCall: ToolCallRepairFunction<ToolSet> = async ({ toolCall, tools }) => {
  const name = normalizeToolName(toolCall.toolName);
  return name !== toolCall.toolName && name in tools ? { ...toolCall, toolName: name } : null;
};

async function withFallback<T>(call: GatewayCall, attempt: (model: LanguageModelV1, abortSignal: AbortSignal) => Promise<T>): Promise<T> {
  const models = call.models ?? getDefaultModels();
  let firstError: unknown = null;

  for (const { id, model } of models) {
    const remaining = (call.deadline ?? Infinity) - Date.now();
    if (remaining <= 0) {
      firstError ??= new DeadlineExceededError();
      break;
    }

    const started = Date.now();
    try {
      const result = await attempt(model, AbortSignal.timeout(Math.min(call.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS, remaining)));
      call.observer?.onModelAttempt?.({ phase: call.phase, modelId: id, durationMs: Date.now() - started });
      if (id !== models[0].id) console.warn(`[AI Gateway] ${call.phase} 使用降級模型: ${id}`);
      return result;
    } catch (err) {
      call.observer?.onModelAttempt?.({ phase: call.phase, modelId: id, durationMs: Date.now() - started, error: err });
      console.warn(`[AI Gateway] ${call.phase} ${id} 失敗: ${describeError(err)}`);
      call.onAttemptFailed?.();
      firstError ??= err;
      if (!shouldFallBack(err)) break;
    }
  }

  // Surface the primary model's error — a fallback's error would hide the real cause.
  throw firstError ?? new Error("All AI models failed");
}

type GenerateTextOptions = Omit<Parameters<typeof generateText>[0], "model" | "abortSignal">;
type GenerateObjectOptions = Omit<Parameters<typeof generateObject>[0], "model" | "abortSignal">;

/** generateText with fallback; an empty final reply counts as a failure. */
export async function aiGenerateText(options: GenerateTextOptions, call: GatewayCall) {
  return withFallback(call, async (model, abortSignal) => {
    const result = await generateText({
      experimental_repairToolCall: repairToolCall,
      ...options,
      model,
      abortSignal,
      // Falling back to the next model is the retry; same-model retries only add backoff delay.
      maxRetries: 0,
    } as Parameters<typeof generateText>[0]);
    if (!result.text.trim()) {
      const substitute = call.emptyReply?.();
      if (!substitute) throw new EmptyResponseError(result.finishReason);
      return { ...result, text: substitute };
    }
    const problem = call.validate?.(result.text);
    if (problem) throw new InvalidReplyError(problem);
    return result;
  });
}

/** generateObject（結構化輸出）with fallback. */
export async function aiGenerateObject<T>(options: GenerateObjectOptions, call: GatewayCall): Promise<T> {
  return withFallback(call, async (model, abortSignal) => {
    const result = await generateObject({ ...options, model, abortSignal, maxRetries: 0 } as Parameters<typeof generateObject>[0]);
    return result.object as T;
  });
}
