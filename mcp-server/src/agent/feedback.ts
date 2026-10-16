/**
 * Thumbs up/down on a Query reply (docs/requirements/QUERY_AGENT_LANGFUSE.md §2.4).
 *
 * The rating is saved in query_messages.metadata.feedback (set_query_message_feedback: own replies
 * only) and sent to Langfuse as the `user-feedback` score on the reply's trace. A thumbs-down on a
 * reply whose trace was not sampled (langfuse.ts) rebuilds that trace from query_traces and the
 * conversation, de-identified like every production trace, so the bad reply can be reviewed.
 * Langfuse failures are logged; the saved rating is what the user sees.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { startObservation } from "@langfuse/tracing";
import { TraceFlags } from "@opentelemetry/api";
import { randomBytes } from "node:crypto";
import { AccessError } from "./auth-guard.js";
import {
  allowTrace, flushTracing, inSample, langfuseClient, langfuseTraceId, maskText, PRODUCTION_SAMPLE_RATE, tracingEnabled,
  type KnownValues,
} from "./langfuse.js";

export type FeedbackValue = "up" | "down";

export const FEEDBACK_SCORE = "user-feedback";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MessageMetadata {
  trace_id?: string;
  feedback?: { value: FeedbackValue; at: string };
}

interface TraceRow {
  id: string;
  organization_id: string;
  created_at: string;
  status: string;
  model: string | null;
  fallback_from: string | null;
  route: { agents?: string[]; fallback?: boolean } | null;
  attempts: { phase: string; model: string; duration_ms: number; error?: string }[] | null;
  steps: { agent: string; tools: { name: string; args: string }[] }[] | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  prompts: Record<string, unknown> | null;
}

/** One score per message and value, so changing the rating removes the other one. */
const scoreId = (messageId: string, value: FeedbackValue) => `feedback-${messageId}-${value}`;

export function parseFeedbackValue(value: unknown): FeedbackValue | null {
  if (value === "up" || value === "down" || value === null) return value;
  throw new AccessError("value 只能是 up、down 或 null", 400);
}

/** Saves the rating and mirrors it to Langfuse; returns the message's feedback. */
export async function setFeedback(
  supabase: SupabaseClient,
  messageId: string,
  value: FeedbackValue | null
): Promise<{ feedback: MessageMetadata["feedback"] | null }> {
  if (!UUID_RE.test(messageId)) throw new AccessError("找不到這則回覆", 404);
  const { data, error } = await supabase.rpc("set_query_message_feedback", { p_message_id: messageId, p_value: value });
  if (error) {
    if (error.hint === "not_found") throw new AccessError("找不到這則回覆", 404);
    throw new Error(`儲存回饋失敗: ${error.message}`);
  }
  const metadata = (data ?? {}) as MessageMetadata;

  if (metadata.trace_id && tracingEnabled()) {
    try {
      await sendToLangfuse(supabase, messageId, metadata.trace_id, value);
    } catch (err) {
      console.warn("[Feedback] 送出到 Langfuse 失敗:", err instanceof Error ? err.message : err);
    }
  }
  return { feedback: metadata.feedback ?? null };
}

let feedbackConfigId: Promise<string | undefined> | null = null;

/** The `user-feedback` score config (created by the eval, evals/experiment.ts). */
function configId(): Promise<string | undefined> {
  feedbackConfigId ??= langfuseClient().api.scoreConfigs.get({ limit: 100 })
    .then((res) => res.data.find((c) => c.name === FEEDBACK_SCORE && !c.isArchived)?.id)
    .catch(() => {
      feedbackConfigId = null;
      return undefined;
    });
  return feedbackConfigId;
}

async function sendToLangfuse(supabase: SupabaseClient, messageId: string, queryTraceId: string, value: FeedbackValue | null): Promise<void> {
  const langfuse = langfuseClient();
  const traceId = await langfuseTraceId(queryTraceId);

  const stale = (["up", "down"] as const).filter((v) => v !== value);
  await Promise.all(stale.map((v) => langfuse.api.scores.delete(scoreId(messageId, v)).catch(() => undefined)));
  if (!value) return;

  if (value === "down") await backfill(supabase, messageId, queryTraceId, traceId);
  const config = await configId();
  langfuse.score.create({
    id: scoreId(messageId, value),
    traceId,
    name: FEEDBACK_SCORE,
    value: value === "up" ? 1 : 0,
    dataType: "BOOLEAN",
    ...(config ? { configId: config } : {}),
  });
  await langfuse.score.flush();
}

/** Whether the request's own trace was sent (langfuse.ts: failures, fallbacks and the sample). */
export function wasSent(row: Pick<TraceRow, "status" | "fallback_from" | "route" | "attempts">, traceId: string): boolean {
  const degraded = row.status === "error" || !!row.fallback_from || !!row.route?.fallback || !!row.attempts?.some((a) => a.error);
  return degraded || inSample(traceId, PRODUCTION_SAMPLE_RATE);
}

/** Whether Langfuse already holds the trace (sent, or rebuilt by an earlier thumbs-down). */
async function inLangfuse(traceId: string, createdAt: string): Promise<boolean> {
  const from = new Date(new Date(createdAt).getTime() - 60_000).toISOString();
  const res = await langfuseClient().api.observations.getMany({ traceId, fromStartTime: from, limit: 1, fields: "core" });
  return res.data.length > 0;
}

/**
 * The organization's contact people and addresses. A rebuilt trace has no tool results to find
 * them in (langfuse.ts masks those a request read), so every one the reply might repeat is masked.
 */
async function organizationKnownValues(supabase: SupabaseClient, organizationId: string): Promise<KnownValues> {
  const known: KnownValues = new Map();
  for (const table of ["customers", "factories"]) {
    const { data } = await supabase.from(table).select("contact_person, address").eq("organization_id", organizationId);
    for (const r of (data ?? []) as { contact_person: string | null; address: string | null }[]) {
      if (r.contact_person && r.contact_person.length >= 2) known.set(r.contact_person, "[聯絡人]");
      if (r.address && r.address.length >= 2) known.set(r.address, "[地址]");
    }
  }
  return known;
}

/**
 * Rebuilds an unsampled trace from what query_traces kept: the question, the reply, the route,
 * every model attempt and the tool calls. Model inputs and outputs were not kept, so they are absent.
 */
async function backfill(supabase: SupabaseClient, messageId: string, queryTraceId: string, traceId: string): Promise<void> {
  const { data: row } = await supabase.from("query_traces")
    .select("id, organization_id, created_at, status, model, fallback_from, route, attempts, steps, input_tokens, output_tokens, latency_ms, prompts")
    .eq("id", queryTraceId).maybeSingle<TraceRow>();
  if (!row || wasSent(row, traceId) || (await inLangfuse(traceId, row.created_at))) return;

  const { data: reply } = await supabase.from("query_messages").select("session_id, content, created_at").eq("id", messageId).single();
  const { data: question } = reply
    ? await supabase.from("query_messages").select("content")
      .eq("session_id", reply.session_id).eq("role", "user").lt("created_at", reply.created_at)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  const known = await organizationKnownValues(supabase, row.organization_id);
  const mask = (text: string | undefined) => (text === undefined ? null : maskText(text, known));
  allowTrace(traceId);
  const start = new Date(row.created_at);
  const end = new Date(start.getTime() + (row.latency_ms ?? 0));
  const root = startObservation("query", {
    input: mask(question?.content),
    output: mask(reply?.content),
    metadata: {
      query_trace_id: row.id,
      backfilled: "倒讚後由 query_traces 重建，沒有模型的輸入輸出",
      route: row.route?.agents ?? null,
      prompts: row.prompts,
      tokens: { input: row.input_tokens, output: row.output_tokens },
    },
    ...(row.status === "error" ? { level: "ERROR" as const } : {}),
  }, { asType: "agent", startTime: start, parentSpanContext: { traceId, spanId: randomBytes(8).toString("hex"), traceFlags: TraceFlags.SAMPLED } });

  // Children with their recorded start times, so the timeline matches the request.
  const parentSpanContext = root.otelSpan.spanContext();
  let at = start.getTime();
  for (const a of row.attempts ?? []) {
    const attempt = startObservation(a.phase, {
      model: a.model,
      ...(a.error ? { level: "ERROR" as const, statusMessage: a.error } : {}),
    }, { asType: "generation", startTime: new Date(at), parentSpanContext });
    at += a.duration_ms;
    attempt.end(new Date(at));
  }
  for (const step of row.steps ?? []) {
    for (const tool of step.tools) {
      startObservation(tool.name, { input: mask(tool.args), metadata: { agent: step.agent } }, { asType: "tool", startTime: end, parentSpanContext }).end(end);
    }
  }
  root.end(end);
  await flushTracing();
}
