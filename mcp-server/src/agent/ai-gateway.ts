/**
 * AI Gateway — Provider-Agnostic 層
 *
 * 底層統一指向 OpenRouter，可隨時換成任何相容 provider。
 * 模型優先級：主模型失敗自動降級，不影響上層業務邏輯。
 * 降級規則見 docs/requirements/QUERY_AGENT_PHASE0.md §4.5。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, generateObject, APICallError, NoSuchToolError, type ToolCallRepairFunction, type ToolSet } from "ai";
import type { LanguageModelV1 } from "@ai-sdk/provider";
import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { normalizeToolName, type ModelCall, type QueryRun } from "./observer.js";
import { TOOL_GROUPS } from "./permissions.js";
import { tracingEnabled } from "./langfuse.js";
import type { PromptLink } from "./prompts.js";

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
  /** The Langfuse prompt version of the system prompt; its generations are linked to it. */
  prompt?: PromptLink;
  /** Called when an attempt fails, before the next model is tried — discard that attempt's drafts. */
  onAttemptFailed?: () => void;
  /** Checks a finished text reply; returning a reason rejects it and falls back to the next model. */
  validate?: (text: string) => string | null;
  /** Text to use when the model finished with no text but the attempt still did its job. */
  emptyReply?: () => string | null;
  /**
   * The reply when the model calls a tool it was not given (NoSuchToolError). Defaults to
   * unavailableToolReply(); a caller that knows the user's permissions can be more specific.
   */
  unavailableToolReply?: (toolName: string) => string;
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
  // Same API key for every model.
  if (APICallError.isInstance(err) && (err.statusCode === 401 || err.statusCode === 403)) return false;
  return true;
}

/** Standard replies (QUERY_AGENT_TPM_ALIGNMENT.md §3.4). */
export const UNSUPPORTED_REPLY = "Query 現在還沒有這個功能。";
export const UNAVAILABLE_REPLY = "Query 沒辦法在這裡完成這項操作。如果你沒有這項操作的權限，需要請管理員幫你操作；也可以換個方式描述你要做的事。";

/**
 * A tool the model called but was not given. A tool no agent has is an operation Query does not
 * support; a tool that exists elsewhere was withheld — the user lacks the permission, or the
 * router picked another agent — which the gateway cannot tell apart.
 */
export function unavailableToolReply(toolName: string): string {
  const name = normalizeToolName(toolName);
  const exists = Object.values(TOOL_GROUPS).some((tools) => (tools as readonly string[]).includes(name));
  return exists ? UNAVAILABLE_REPLY : UNSUPPORTED_REPLY;
}

/**
 * Gemini sometimes writes the tool call as text ("tool_code print(default_api.list_orders(...))")
 * instead of calling it. Such a reply answers nothing, so it falls back to the next model.
 */
export const TOOL_CALL_AS_TEXT = /^\s*tool_code\b|\bdefault_api\.\w+\(/;

/** Gemini sometimes calls `default_api.<tool>`; map it back instead of registering aliases (F4). */
const repairToolCall: ToolCallRepairFunction<ToolSet> = async ({ toolCall, tools }) => {
  const name = normalizeToolName(toolCall.toolName);
  return name !== toolCall.toolName && name in tools ? { ...toolCall, toolName: name } : null;
};

/**
 * AI SDK telemetry for one attempt: Langfuse records each provider call as a generation (model,
 * tokens, cost, input and output) under the request's trace (langfuse.ts). The attempt is named
 * after its model — the phase is the observation around it (tracedPhase) — so a fallback reads
 * as "agent:commercial → google/gemini-2.5-flash-lite, google/gemini-2.5-flash".
 */
function telemetry(call: GatewayCall, modelId: string) {
  return { isEnabled: tracingEnabled(), functionId: modelId, metadata: { phase: call.phase, model: modelId } };
}

/**
 * The phase as one Langfuse observation holding its model attempts and tool calls: a sub-agent
 * ("agent:<group>") is an agent, the router and the summary are chains. Langfuse draws the
 * request as router → sub-agents → summary from these.
 */
function tracedPhase<T>(call: GatewayCall, input: unknown, fn: () => Promise<T>, output: (result: T) => unknown): Promise<T> {
  if (!tracingEnabled()) return fn();
  const run = async (span: { update(attributes: Record<string, unknown>): unknown }): Promise<T> => {
    span.update({ input, metadata: { phase: call.phase } });
    try {
      const result = await fn();
      span.update({ output: output(result) });
      return result;
    } catch (err) {
      span.update({ level: "ERROR", statusMessage: String(err instanceof Error ? err.message : err).slice(0, 500) });
      throw err;
    }
  };
  return call.phase.startsWith("agent:")
    ? startActiveObservation(call.phase, run, { asType: "agent" })
    : startActiveObservation(call.phase, run, { asType: "chain" });
}

/** What a phase was asked: the last message (the task or the user's message). */
function phaseInput(options: { messages?: unknown; prompt?: unknown }): unknown {
  return Array.isArray(options.messages) ? options.messages.at(-1) : options.prompt;
}

/** Runs fn with the phase as a trace tag and the prompt version linked to its generations. */
function inPhase<T>(call: GatewayCall, fn: () => Promise<T>): Promise<T> {
  if (!tracingEnabled()) return fn();
  return propagateAttributes({ tags: [call.phase], ...(call.prompt ? { prompt: call.prompt } : {}) }, fn);
}

async function withFallback<T>(call: GatewayCall, attempt: (model: LanguageModelV1, abortSignal: AbortSignal, modelId: string) => Promise<T>): Promise<T> {
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
      const result = await callRecorder.run(recorder, () => inPhase(call, () => attempt(model, signal, id)));
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

type GenerateTextResult = Awaited<ReturnType<typeof generateText>>;

/**
 * generateText with fallback; an empty final reply counts as a failure. A call to a tool the model
 * was not given ends the request with a standard reply instead of an error: another model would
 * see the same tools, and the user should not get a failure for asking (TPM §3.4). Only `text` is
 * meaningful on such a result.
 */
export async function aiGenerateText(options: GenerateTextOptions, call: GatewayCall): Promise<GenerateTextResult> {
  return tracedPhase(call, phaseInput(options as never), () => generateTextWithFallback(options, call), (r) => r.text);
}

function generateTextWithFallback(options: GenerateTextOptions, call: GatewayCall): Promise<GenerateTextResult> {
  return withFallback(call, async (model, abortSignal, modelId) => {
    let result: GenerateTextResult;
    try {
      result = await generateText({
        experimental_repairToolCall: repairToolCall,
        ...options,
        model,
        abortSignal,
        experimental_telemetry: telemetry(call, modelId),
        // Falling back to the next model is the retry; same-model retries only add backoff delay.
        maxRetries: 0,
      } as Parameters<typeof generateText>[0]);
    } catch (err) {
      if (!NoSuchToolError.isInstance(err)) throw err;
      console.warn(`[AI Gateway] ${call.phase} 呼叫了沒有的工具: ${err.toolName}`);
      const text = (call.unavailableToolReply ?? unavailableToolReply)(err.toolName);
      return { text, steps: [], toolCalls: [], toolResults: [], finishReason: "error" } as unknown as GenerateTextResult;
    }
    if (!result.text.trim()) {
      const substitute = call.emptyReply?.();
      if (!substitute) throw new EmptyResponseError(result.finishReason);
      return { ...result, text: substitute };
    }
    if (TOOL_CALL_AS_TEXT.test(result.text)) throw new InvalidReplyError("模型把工具呼叫寫成文字");
    const problem = call.validate?.(result.text);
    if (problem) throw new InvalidReplyError(problem);
    return result;
  });
}

/** generateObject（結構化輸出）with fallback. */
export async function aiGenerateObject<T>(options: GenerateObjectOptions, call: GatewayCall): Promise<T> {
  return tracedPhase(call, phaseInput(options as never), () => generateObjectWithFallback<T>(options, call), (r) => r);
}

function generateObjectWithFallback<T>(options: GenerateObjectOptions, call: GatewayCall): Promise<T> {
  return withFallback(call, async (model, abortSignal, modelId) => {
    const result = await generateObject({
      ...options,
      model,
      abortSignal,
      maxRetries: 0,
      experimental_telemetry: telemetry(call, modelId),
    } as Parameters<typeof generateObject>[0]);
    return result.object as T;
  });
}
