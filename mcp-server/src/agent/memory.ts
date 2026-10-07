/**
 * 對話記憶（docs/QUERY_AGENT_PHASE0.md §4.4）
 *
 * - 對話內容由後端從 query_messages 讀取（使用者 JWT，RLS 只能讀自己的對話），不信任前端送來的 history
 * - 工具查到的特定紀錄（實體）存在 assistant 回覆的 metadata.entities，下一輪寫進 system prompt，
 *   模型可直接用 ID 呼叫工具，不必重新查詢
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ObservedStep, QueryObserver } from "./observer.js";
import type { ConversationMessage } from "./sub-agents.js";

export type EntityType = "customer" | "factory" | "product" | "order" | "purchase_order" | "shipping";

export interface Entity {
  type: EntityType;
  id: string;
  label: string;
}

export interface StoredMessage extends ConversationMessage {
  /** "action" = a confirmation card (UI only). */
  kind?: "text" | "action";
  metadata?: { entities?: Entity[]; trace_id?: string; action_id?: string; action_ids?: string[]; action_outcome?: boolean };
}

/** Messages sent to the model as history (about 6–8k tokens). */
const HISTORY_LIMIT = 20;
/** A lookup that returns more rows than this is a browse, not a specific record. */
const MAX_ROWS_PER_LOOKUP = 3;
/** Entities carried into the prompt, most recent first. */
const MAX_ENTITIES = 10;

const ENTITY_LABELS: Record<EntityType, string> = {
  customer: "客戶",
  factory: "工廠",
  product: "產品",
  order: "訂單",
  purchase_order: "採購單",
  shipping: "出貨單",
};

type Row = Record<string, unknown>;
type Extractor = (row: Row) => Entity | null;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const entity = (type: EntityType, id: unknown, ...labelParts: unknown[]): Entity | null => {
  const label = labelParts.map(str).filter(Boolean).join(" ");
  return str(id) && label ? { type, id: id as string, label } : null;
};

/** Which records each read tool returns, and how to name them. */
const EXTRACTORS: Partial<Record<string, Extractor>> = {
  list_customers: (r) => entity("customer", r.id, r.name),
  get_customer: (r) => entity("customer", r.id, r.name),
  list_factories: (r) => entity("factory", r.id, r.name),
  list_products: (r) => entity("product", r.id, r.name, r.color),
  get_product: (r) => entity("product", r.id, r.name, r.color),
  get_inventory_summary: (r) => entity("product", r.product_id, r.product_name, r.color),
  list_orders: (r) => entity("order", r.id, r.order_number),
  get_order: (r) => entity("order", r.id, r.order_number),
  list_purchase_orders: (r) => entity("purchase_order", r.id, r.po_number),
  get_purchase_order: (r) => entity("purchase_order", r.id, r.po_number),
  list_shippings: (r) => entity("shipping", r.id, r.shipping_number),
  get_shipping: (r) => entity("shipping", r.id, r.shipping_number),
};

/** Entities from one tool result: a single record, or a list of at most MAX_ROWS_PER_LOOKUP. */
export function entitiesFromToolResult(toolName: string, result: unknown): Entity[] {
  const extract = EXTRACTORS[toolName];
  if (!extract || !result || typeof result !== "object") return [];
  const rows = Array.isArray(result) ? result : [result];
  if (rows.length > MAX_ROWS_PER_LOOKUP) return [];
  return rows.flatMap((row) => (row && typeof row === "object" ? extract(row as Row) ?? [] : []));
}

/** Later mentions win; keeps the most recent MAX_ENTITIES. */
function mergeEntities(entities: Entity[]): Entity[] {
  const byKey = new Map<string, Entity>();
  for (const e of entities) {
    const key = `${e.type}:${e.id}`;
    byKey.delete(key);
    byKey.set(key, e);
  }
  return [...byKey.values()].slice(-MAX_ENTITIES);
}

export function entitiesFromHistory(messages: StoredMessage[]): Entity[] {
  return mergeEntities(messages.flatMap((m) => (m.role === "assistant" ? m.metadata?.entities ?? [] : [])));
}

/** System-prompt addition listing known entities; empty when there are none. */
export function entityNote(entities: Entity[]): string {
  if (!entities.length) return "";
  const lines = entities.map((e) => `- ${ENTITY_LABELS[e.type]}：${e.label}（id: ${e.id}）`);
  return `

對話中已確認的資料：
${lines.join("\n")}
- 需要這些資料時直接使用上方的 id 呼叫工具，不必重新查詢；回覆使用者時仍不可顯示 id`;
}

/** Collects entities from this request's tool results (QueryObserver). */
export class EntityCollector implements QueryObserver {
  private readonly found: Entity[] = [];

  onStep(_agent: string, step: ObservedStep): void {
    for (const r of step.toolResults) this.found.push(...entitiesFromToolResult(r.toolName, r.result));
  }

  get entities(): Entity[] {
    return mergeEntities(this.found);
  }
}

/**
 * The session's messages before `beforeMessageId` (the user message this request answers),
 * oldest first, at most HISTORY_LIMIT. Without it, the latest messages.
 */
export async function loadHistory(
  supabase: SupabaseClient,
  sessionId: string,
  beforeMessageId?: string | null
): Promise<StoredMessage[]> {
  let q = supabase.from("query_messages").select("role, kind, content, metadata").eq("session_id", sessionId);
  if (beforeMessageId) {
    const { data: current } = await supabase.from("query_messages").select("created_at")
      .eq("id", beforeMessageId).eq("session_id", sessionId).maybeSingle();
    if (current?.created_at) q = q.lt("created_at", current.created_at);
  }
  const { data, error } = await q.order("created_at", { ascending: false }).limit(HISTORY_LIMIT);
  if (error) throw new Error(`讀取對話紀錄失敗：${error.message}`);
  return ((data ?? []) as StoredMessage[])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .reverse();
}

/**
 * The conversation as the model should see it. Stored messages include things the model
 * imitates instead of calling tools — seen live and in evals: given its own earlier "已建立草稿，
 * 請在下方確認卡片確認" reply, the next "新增客戶…" got a copy of that text and no tool call. So:
 * - a reply that introduced drafts is left out, and so are the cards
 * - what the user did on a card (confirmed / cancelled / failed) becomes a note
 * - consecutive messages from the same role are merged
 * Only "keep just the outcome" made the primary model call the tool reliably (eval 2026-10-07).
 */
export function toModelHistory(stored: StoredMessage[]): ConversationMessage[] {
  const history: ConversationMessage[] = [];
  for (const m of stored) {
    if (m.kind === "action" || m.metadata?.action_ids?.length) continue;
    const content = m.metadata?.action_outcome ? `（使用者在確認卡片上的操作結果：${m.content}）` : m.content;
    const last = history.at(-1);
    if (last && last.role === m.role) last.content = `${last.content}\n${content}`;
    else history.push({ role: m.role, content });
  }
  return history;
}

/** Combines observers so one request can feed the trace and the entity collector. */
export function combineObservers(...observers: QueryObserver[]): QueryObserver {
  return {
    onRoute: (decision, fromFallback) => observers.forEach((o) => o.onRoute?.(decision, fromFallback)),
    onModelAttempt: (attempt) => observers.forEach((o) => o.onModelAttempt?.(attempt)),
    onStep: (agent, step) => observers.forEach((o) => o.onStep?.(agent, step)),
  };
}
