/**
 * 待確認操作（草稿＋確認，docs/QUERY_AGENT_PHASE0.md §4.3）
 *
 * 模型要求的寫入先存成 query_pending_actions（pending），對話中顯示確認卡片；使用者確認後才執行。
 * 以 action id 為冪等鍵：只有把狀態從 pending 搶成 executing 的那一次會執行，重複確認回傳同一結果。
 * 執行走與先前相同的工具實作（RegisteredTool.run），並在執行前重新檢查成員資格與權限。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AccessError, authGuard } from "./auth-guard.js";
import { getTools } from "../tools/index.js";
import type { ActionSummary, Draft } from "../tools/types.js";
import type { ToolName } from "./permissions.js";

export type ActionStatus = "pending" | "executing" | "confirmed" | "cancelled" | "expired" | "failed";

interface ActionRow {
  id: string;
  user_id: string;
  organization_id: string;
  session_id: string | null;
  tool: ToolName;
  payload: unknown;
  summary: ActionSummary;
  status: ActionStatus;
  result: unknown;
  error: string | null;
  expires_at: string;
}

export interface ActionOutcome {
  id: string;
  status: ActionStatus;
  result?: unknown;
  error?: string;
}

export interface PersistedAction {
  id: string;
  summary: ActionSummary;
}

const ACTION_COLUMNS = "id, user_id, organization_id, session_id, tool, payload, summary, status, result, error, expires_at";

const STATUS_MESSAGES: Partial<Record<ActionStatus, string>> = {
  executing: "此操作正在處理中",
  cancelled: "此操作已取消",
  expired: "此草稿已過期，請重新提出要求",
  failed: "此操作已執行失敗",
};

/** Stores the drafts as pending actions (no cards yet — see addActionCards). */
export async function createActions(
  supabase: SupabaseClient,
  drafts: Draft[],
  owner: { userId: string; organizationId: string; sessionId: string | null }
): Promise<PersistedAction[]> {
  const persisted: PersistedAction[] = [];
  for (const draft of drafts) {
    const { data, error } = await supabase.from("query_pending_actions").insert({
      user_id: owner.userId,
      organization_id: owner.organizationId,
      session_id: owner.sessionId,
      tool: draft.tool,
      payload: draft.payload,
      summary: draft.summary,
    }).select("id").single();
    if (error || !data) {
      console.error("[Actions] 儲存草稿失敗:", error?.message);
      continue;
    }
    persisted.push({ id: (data as { id: string }).id, summary: draft.summary });
  }
  return persisted;
}

/** Adds a confirmation-card message per action, after the reply that introduced them. */
export async function addActionCards(supabase: SupabaseClient, sessionId: string, actions: PersistedAction[]): Promise<void> {
  for (const action of actions) {
    const { error } = await supabase.from("query_messages").insert({
      session_id: sessionId, role: "assistant", kind: "action", content: action.summary.title, metadata: { action_id: action.id },
    });
    if (error) console.error("[Actions] 建立確認卡片失敗:", error.message);
  }
}

async function loadAction(supabase: SupabaseClient, actionId: string): Promise<ActionRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AccessError("Invalid or expired JWT", 401);
  // RLS shows only the user's own actions; the user_id check doesn't rely on it.
  const { data } = await supabase.from("query_pending_actions").select(ACTION_COLUMNS).eq("id", actionId).maybeSingle();
  if (!data || (data as ActionRow).user_id !== user.id) throw new AccessError("找不到此操作", 404);
  return data as ActionRow;
}

function outcome(row: ActionRow): ActionOutcome {
  return { id: row.id, status: row.status, ...(row.result != null ? { result: row.result } : {}), ...(row.error ? { error: row.error } : {}) };
}

/** Already decided: the stored outcome for a confirmed action, a conflict for anything else. */
function decided(row: ActionRow): ActionOutcome {
  if (row.status === "confirmed") return outcome(row);
  throw new AccessError(STATUS_MESSAGES[row.status] ?? "此操作無法確認", 409);
}

async function expireIfDue(supabase: SupabaseClient, row: ActionRow): Promise<boolean> {
  if (row.status !== "pending" || new Date(row.expires_at).getTime() > Date.now()) return false;
  await supabase.from("query_pending_actions").update({ status: "expired" }).eq("id", row.id).eq("status", "pending");
  return true;
}

function resultLine(summary: ActionSummary, data: unknown): string {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const ref = [d.order_number && `訂單編號 ${d.order_number}`, d.po_number && `採購單號 ${d.po_number}`].filter(Boolean).join("，");
  return `✅ ${summary.title}已完成${ref ? `：${ref}` : ""}`;
}

/** Posts the outcome to the conversation, marked so the model's history can tell it from its own replies. */
async function postToSession(supabase: SupabaseClient, sessionId: string | null, content: string, actionId: string): Promise<void> {
  if (!sessionId) return;
  const { error } = await supabase.from("query_messages").insert({
    session_id: sessionId, role: "assistant", content, metadata: { action_id: actionId, action_outcome: true },
  });
  if (error) console.error("[Actions] 寫入結果訊息失敗:", error.message);
}

/** Executes a pending action once. Repeated confirmations return the first outcome. */
export async function confirmAction(supabase: SupabaseClient, actionId: string): Promise<ActionOutcome> {
  const row = await loadAction(supabase, actionId);
  if (row.status !== "pending") return decided(row);
  if (await expireIfDue(supabase, row)) throw new AccessError(STATUS_MESSAGES.expired!, 409);

  // Membership and permission may have changed since the draft was made.
  const access = await authGuard(supabase, row.organization_id);
  if (!access.allowedTools.includes(row.tool)) throw new AccessError("你目前沒有執行此操作的權限", 403);

  // Claim: only the request that moves pending → executing runs the write.
  const { data: claimed } = await supabase.from("query_pending_actions")
    .update({ status: "executing", decided_at: new Date().toISOString() })
    .eq("id", row.id).eq("status", "pending").gt("expires_at", new Date().toISOString())
    .select(ACTION_COLUMNS);
  if (!claimed || (claimed as ActionRow[]).length === 0) return decided(await loadAction(supabase, actionId));

  const [tool] = getTools([row.tool]);
  const result = tool
    ? await tool.run({ supabase, userId: access.userId, organizationId: access.organizationId }, row.payload)
    : ({ ok: false, error: `未知的操作：${row.tool}` } as const);

  const finished = result.ok
    ? { status: "confirmed" as const, result: result.data, error: null }
    : { status: "failed" as const, result: null, error: result.error };
  const { error: saveError } = await supabase.from("query_pending_actions").update(finished).eq("id", row.id).eq("status", "executing");
  if (saveError) console.error("[Actions] 記錄執行結果失敗:", saveError.message);

  await postToSession(supabase, row.session_id, result.ok ? resultLine(row.summary, result.data) : `⚠️ ${row.summary.title}失敗：${result.error}`, row.id);
  return { id: row.id, status: finished.status, ...(result.ok ? { result: result.data } : { error: result.error }) };
}

/** Cancels a pending action. Cancelling twice is fine; anything else already decided is a conflict. */
export async function cancelAction(supabase: SupabaseClient, actionId: string): Promise<ActionOutcome> {
  const row = await loadAction(supabase, actionId);
  if (row.status === "cancelled") return outcome(row);
  if (row.status !== "pending") throw new AccessError(STATUS_MESSAGES[row.status] ?? "此操作已完成，無法取消", 409);

  const { data } = await supabase.from("query_pending_actions")
    .update({ status: "cancelled", decided_at: new Date().toISOString() })
    .eq("id", row.id).eq("status", "pending").select(ACTION_COLUMNS);
  const updated = (data as ActionRow[] | null)?.[0];
  if (!updated) return cancelAction(supabase, actionId);
  await postToSession(supabase, row.session_id, `已取消：${row.summary.title}`, row.id);
  return outcome(updated);
}
