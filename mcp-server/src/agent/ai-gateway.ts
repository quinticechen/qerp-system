/**
 * AI Gateway — Provider-Agnostic 層
 *
 * 底層統一指向 OpenRouter，可隨時換成任何相容 provider。
 * 模型優先級：主模型失敗自動降級，不影響上層業務邏輯。
 * 降級規則見 docs/QUERY_AGENT_PHASE0.md §4.5。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, generateObject, APICallError, NoSuchToolError, type ToolCallRepairFunction, type ToolSet } from "ai";
import type { LanguageModelV1 } from "@ai-sdk/provider";
import { normalizeToolName, type ModelCall, type QueryRun } from "./observer.js";

// 模型優先級清單（由上往下降級）
export const MODEL_PRIORITY = [
  "google/gemini-2.5-flash-lite",       // 主力：快、便宜
  "google/gemini-2.5-flash",            // 降級 1：同家族
  "anthropic/claude-haiku-4.5",         // 降級 2：不同 provider（OpenRouter ID 格式）
] as const;

/**
 * Model IDs per phase, first = primary, the rest = fallbacks in order. Phases are "router",
 * "agent:commercial", "agent:supply_chain" and "agent:all" (single agent); a phase without its
 * own entry uses `default`.
 */
export type ModelPolicy = { readonly default: readonly string[] } & { readonly [phase: string]: readonly string[] | undefined };

/** Production models. Give a phase its own entry only after an eval comparison (docs/QUERY_AGENT_EVALS.md). */
export const MODEL_POLICY: ModelPolicy = {
  default: MODEL_PRIORITY,
};

export function modelIdsFor(policy: ModelPolicy, phase: string): readonly string[] {
  return policy[phase] ?? policy.default;
}

/** Upper bound for one model attempt; the request deadline can cut it shorter. */
const ATTEMPT_TIMEOUT_MS = 30_000;

export interface GatewayModel {
  id: string;
  model: LanguageModelV1;
}

interface CallRecorder {
  calls: ModelCall[];
  captureIO: boolean;
}

/** The attempt in progress, so recordingFetch knows where a provider call belongs. */
const callRecorder = new AsyncLocalStorage<CallRecorder>();

interface CompletionBody {
  provider?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  choices?: { message?: unknown }[];
}

/** Records each completion's tokens and cost — OpenRouter reports the billed cost in `usage.cost`. */
const recordingFetch: typeof fetch = async (input, init) => {
  const recorder = callRecorder.getStore();
  const startedAt = Date.now();
  const response = await fetch(input, init);
  if (!recorder || !response.ok) return response;
  try {
    const body = (await response.clone().json()) as CompletionBody;
    const call: ModelCall = {
      startedAt,
      durationMs: Date.now() - startedAt,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      costUsd: typeof body.usage?.cost === "number" ? body.usage.cost : null,
      ...(body.provider ? { provider: body.provider } : {}),
    };
    if (recorder.captureIO) {
      call.input = typeof init?.body === "string" ? (JSON.parse(init.body) as { messages?: unknown }).messages : undefined;
      call.output = body.choices?.[0]?.message;
    }
    recorder.calls.push(call);
  } catch {
    // Not a JSON completion: nothing to record.
  }
  return response;
};

let openrouter: ReturnType<typeof createOpenRouter> | null = null;
const modelCache = new Map<string, GatewayModel>();

/** OpenRouter models in the given order. */
export function modelsFor(ids: readonly string[]): GatewayModel[] {
  openrouter ??= createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY!, fetch: recordingFetch });
  return ids.map((id) => {
    if (!modelCache.has(id)) modelCache.set(id, { id, model: openrouter!(id) as unknown as LanguageModelV1 });
    return modelCache.get(id)!;
  });
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
  const models = call.models ?? modelsFor(modelIdsFor(call.modelPolicy ?? MODEL_POLICY, call.phase));
  let firstError: unknown = null;

  for (const { id, model } of models) {
    const remaining = (call.deadline ?? Infinity) - Date.now();
    if (remaining <= 0) {
      firstError ??= new DeadlineExceededError();
      break;
    }

    const started = Date.now();
    const recorder: CallRecorder = { calls: [], captureIO: !!call.captureModelIO };
    const observed = () => ({ phase: call.phase, modelId: id, startedAt: started, durationMs: Date.now() - started, calls: recorder.calls });
    try {
      const signal = AbortSignal.timeout(Math.min(call.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS, remaining));
      const result = await callRecorder.run(recorder, () => attempt(model, signal));
      call.observer?.onModelAttempt?.(observed());
      if (id !== models[0].id) console.warn(`[AI Gateway] ${call.phase} 使用降級模型: ${id}`);
      return result;
    } catch (err) {
      call.observer?.onModelAttempt?.({ ...observed(), error: err });
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
