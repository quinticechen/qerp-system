/**
 * Query Observer — 觀察一次 Query 請求的內部過程（路由決策、模型嘗試、每一步的 tool 呼叫）
 *
 * 目前供 eval harness 使用（evals/run.ts），之後 P0-6 的 trace 也會建立在這個介面上。
 * 所有 callback 皆為選用；未傳入 observer 時不影響任何行為。
 */

import type { AgentGroup } from "./permissions.js";
import type { GatewayModel } from "./ai-gateway.js";
import type { Entity } from "./memory.js";
import type { Draft } from "../tools/types.js";

export interface ObservedToolCall {
  toolName: string;
  args: unknown;
}

export interface ObservedToolResult {
  toolName: string;
  result: unknown;
}

export interface ObservedStep {
  toolCalls: ObservedToolCall[];
  toolResults: ObservedToolResult[];
  promptTokens: number;
  completionTokens: number;
}

export interface RouteDecision {
  agents: AgentGroup[];
  tasks: Partial<Record<AgentGroup, string>>;
}

export interface ObservedAttempt {
  /** "router" or "agent:<group>". */
  phase: string;
  modelId: string;
  durationMs: number;
  /** Set when the attempt failed. */
  error?: unknown;
}

export interface QueryObserver {
  onRoute?(decision: RouteDecision, fromFallback: boolean): void;
  onModelAttempt?(attempt: ObservedAttempt): void;
  /** `agent` is the sub-agent group, or "all" for the single agent. */
  onStep?(agent: string, step: ObservedStep): void;
}

/** Per-request options threaded from the entry point through router, sub-agents and gateway. */
export interface QueryRun {
  observer?: QueryObserver;
  /** Epoch ms. No model attempt starts after it, and a running one is aborted at it. */
  deadline?: number;
  /** Overrides the provider list — tests pass mock models. */
  models?: GatewayModel[];
  /** Records found earlier in the conversation (memory.ts); listed in sub-agent prompts. */
  entities?: Entity[];
  /** Collects the writes the model asked for, from successful attempts only. */
  drafts?: Draft[];
}

// Gemini via OpenRouter sometimes prefixes tool names; the gateway repairs such calls.
export function normalizeToolName(name: string): string {
  return name.startsWith("default_api.") ? name.slice("default_api.".length) : name;
}
