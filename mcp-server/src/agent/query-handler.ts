import { SupabaseClient } from "@supabase/supabase-js";
import { authGuard } from "./auth-guard.js";
import { answerQuery } from "./answer.js";
import { TraceRecorder } from "./trace.js";
import { EntityCollector, combineObservers, entitiesFromHistory, loadHistory, toModelHistory, type StoredMessage } from "./memory.js";
import type { GatewayModel } from "./ai-gateway.js";
import { createActions, addActionCards, type PersistedAction } from "./actions.js";
import type { Draft } from "../tools/types.js";
import type { ConversationMessage } from "./sub-agents.js";

/** Whole-request budget; each model attempt is also capped (ai-gateway.ts). */
const REQUEST_TIMEOUT_MS = 90_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QueryRequest {
  message: string;
  organizationId: unknown;
  /** The chat session; history is read from it and the reply is saved to it. */
  sessionId?: unknown;
  /** The user message (already saved) this request answers; history is everything before it. */
  messageId?: unknown;
  /** Only for callers without a session (stateless); ignored when sessionId is valid. */
  history?: ConversationMessage[];
}

export interface QueryResponse {
  reply: string;
  allowedToolCount: number;
  /** query_traces.id — lets a reported problem be looked up. */
  traceId: string;
  /** The saved assistant message; null when there is no session or saving failed (caller saves it). */
  messageId: string | null;
  /** Writes awaiting confirmation (POST /query/actions/:id/confirm); a card is added to the session for each. */
  actions: PersistedAction[];
}

const asUuid = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v : null);

/** The chat session, if the caller sent one that belongs to them and this organization. */
async function resolveSessionId(supabase: SupabaseClient, sessionId: unknown, organizationId: string): Promise<string | null> {
  const id = asUuid(sessionId);
  if (!id) return null;
  const { data } = await supabase.from("query_sessions").select("id")
    .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  return data?.id ?? null;
}

async function saveReply(
  supabase: SupabaseClient,
  sessionId: string,
  reply: string,
  metadata: StoredMessage["metadata"]
): Promise<string | null> {
  const { data, error } = await supabase.from("query_messages")
    .insert({ session_id: sessionId, role: "assistant", content: reply, metadata })
    .select("id").single();
  if (error) {
    console.error("[Query] 儲存回覆失敗:", error.message);
    return null;
  }
  return (data as { id: string }).id;
}

/**
 * 主入口：接收用戶訊息，完整走完三層流程
 * Layer 1 → Auth Guard（組織成員與權限）
 * Layer 2 → Router Agent
 * Layer 3 → Sub Agents
 */
export async function handleQuery(
  supabase: SupabaseClient,
  request: QueryRequest,
  options: { models?: GatewayModel[] } = {}
): Promise<QueryResponse> {
  const access = await authGuard(supabase, request.organizationId);
  const sessionId = await resolveSessionId(supabase, request.sessionId, access.organizationId);
  const stored: StoredMessage[] = sessionId
    ? await loadHistory(supabase, sessionId, asUuid(request.messageId))
    : request.history ?? [];

  const trace = new TraceRecorder();
  const entities = new EntityCollector();
  const drafts: Draft[] = [];
  const meta = { userId: access.userId, organizationId: access.organizationId, sessionId };

  try {
    const reply = await answerQuery(
      request.message,
      { supabase, userId: access.userId, organizationId: access.organizationId },
      access.allowedTools,
      toModelHistory(stored),
      {
        observer: combineObservers(trace, entities),
        deadline: Date.now() + REQUEST_TIMEOUT_MS,
        entities: entitiesFromHistory(stored),
        drafts,
        models: options.models,
      }
    );
    await trace.save(supabase, meta);
    const actions = await createActions(supabase, drafts, meta);
    // action_ids marks a reply that introduced drafts — its text is left out of later model
    // history (memory.ts toModelHistory) because the model imitates it instead of calling tools.
    const messageId = sessionId
      ? await saveReply(supabase, sessionId, reply, {
          trace_id: trace.id,
          entities: entities.entities,
          ...(actions.length ? { action_ids: actions.map((a) => a.id) } : {}),
        })
      : null;
    // Cards go after the reply so the conversation reads: answer, then what to confirm.
    if (sessionId) await addActionCards(supabase, sessionId, actions);
    return { reply, allowedToolCount: access.allowedTools.length, traceId: trace.id, messageId, actions };
  } catch (err) {
    await trace.save(supabase, { ...meta, error: err });
    throw err;
  }
}
