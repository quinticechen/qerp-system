/**
 * Query Trace — one row in query_traces per /query request (docs/QUERY_AGENT_PHASE0.md §4.6).
 *
 * Collects what happened through the QueryObserver callbacks and writes it with the user's own
 * client (RLS: own rows, in an organization the user belongs to). Saving never affects the reply.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeError } from "./ai-gateway.js";
import type { ObservedAttempt, ObservedStep, QueryObserver, RouteDecision } from "./observer.js";

const ARGS_PREVIEW_CHARS = 300;
const RETENTION_DAYS = 30;

interface TraceStep {
  agent: string;
  tools: { name: string; args: string }[];
}

export class TraceRecorder implements QueryObserver {
  readonly id = randomUUID();
  private readonly started = Date.now();
  private route: (RouteDecision & { fallback: boolean }) | null = null;
  private readonly attempts: ObservedAttempt[] = [];
  private readonly steps: TraceStep[] = [];
  private inputTokens = 0;
  private outputTokens = 0;

  onRoute(decision: RouteDecision, fromFallback: boolean): void {
    this.route = { ...decision, fallback: fromFallback };
  }

  onModelAttempt(attempt: ObservedAttempt): void {
    this.attempts.push(attempt);
  }

  onStep(agent: string, step: ObservedStep): void {
    this.inputTokens += step.promptTokens;
    this.outputTokens += step.completionTokens;
    if (step.toolCalls.length) {
      this.steps.push({
        agent,
        tools: step.toolCalls.map((c) => ({ name: c.toolName, args: JSON.stringify(c.args).slice(0, ARGS_PREVIEW_CHARS) })),
      });
    }
  }

  /** Writes the trace; logs and swallows any failure. */
  async save(
    supabase: SupabaseClient,
    meta: { userId: string; organizationId: string; sessionId: string | null; error?: unknown }
  ): Promise<void> {
    const succeeded = this.attempts.filter((a) => !a.error);
    const finalAttempt = succeeded.filter((a) => a.phase.startsWith("agent:")).at(-1) ?? succeeded.at(-1);
    const firstFailure = this.attempts.find((a) => a.error);

    const { error } = await supabase.from("query_traces").insert({
      id: this.id,
      user_id: meta.userId,
      organization_id: meta.organizationId,
      session_id: meta.sessionId,
      status: meta.error ? "error" : "ok",
      model: finalAttempt?.modelId ?? null,
      fallback_from: firstFailure?.modelId ?? null,
      route: this.route,
      attempts: this.attempts.map((a) => ({
        phase: a.phase,
        model: a.modelId,
        duration_ms: a.durationMs,
        ...(a.error ? { error: describeError(a.error).slice(0, 500) } : {}),
      })),
      steps: this.steps,
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      latency_ms: Date.now() - this.started,
      error: meta.error ? describeError(meta.error).slice(0, 1000) : null,
    });
    if (error) {
      console.error("[Trace] 寫入失敗:", error.message);
      return;
    }

    // Retention without pg_cron: drop this user's expired traces (RLS allows only those).
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
    const { error: purgeError } = await supabase.from("query_traces").delete().eq("user_id", meta.userId).lt("created_at", cutoff);
    if (purgeError) console.error("[Trace] 清除過期紀錄失敗:", purgeError.message);
  }
}
