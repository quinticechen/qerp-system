/**
 * Record references: users name records by document number (B…, P…, I…, O…, roll numbers) or by
 * name, and the model passes those straight into id parameters. A tool input declared as a
 * reference accepts a UUID, a number or a name; the tool resolves it inside the organization
 * before running, and answers the model with a message (not found, or the matches to choose
 * from) instead of failing the call.
 */

import { z } from "zod";
import type { ToolContext } from "./types.js";
import { applySearch } from "./search.js";

export type RefKind = "customer" | "factory" | "shelf" | "order" | "purchase_order" | "receiving" | "shipping" | "roll";

interface RefSpec {
  table: string;
  /** Column the user names the record by. */
  column: string;
  /** Shown in messages to the model. */
  label: string;
  /** Rows belong to the organization through another table (inventory_rolls → inventories). */
  viaBatch?: boolean;
}

const SPECS: Record<RefKind, RefSpec> = {
  customer: { table: "customers", column: "name", label: "客戶" },
  factory: { table: "factories", column: "name", label: "工廠" },
  shelf: { table: "warehouses", column: "name", label: "貨架" },
  order: { table: "orders", column: "order_number", label: "訂單" },
  purchase_order: { table: "purchase_orders", column: "po_number", label: "採購單" },
  receiving: { table: "inventories", column: "receipt_number", label: "進貨單" },
  shipping: { table: "shippings", column: "shipping_number", label: "出貨單" },
  roll: { table: "inventory_rolls", column: "roll_number", label: "布卷", viaBatch: true },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Matches listed when a reference is ambiguous. */
const MAX_CHOICES = 5;

/** A tool input that takes a record by UUID, number or name. */
export function refInput(description: string) {
  return z.string().min(1).describe(description);
}

type Resolved = { ok: true; id: string } | { ok: false; error: string };

/** Batch ids for tables that belong to the organization through inventories; null for the rest. */
async function batchIds(ctx: ToolContext, spec: RefSpec): Promise<string[] | null> {
  if (!spec.viaBatch) return null;
  const { data } = await ctx.supabase.from("inventories").select("id").eq("organization_id", ctx.organizationId);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/** One reference → the record's id. UUIDs pass through; the tool or API checks the organization. */
export async function resolveRef(ctx: ToolContext, kind: RefKind, value: string): Promise<Resolved> {
  const term = value.trim();
  if (UUID_RE.test(term)) return { ok: true, id: term };
  const spec = SPECS[kind];
  // Built synchronously: a query builder is thenable, so returning one from an async function runs it.
  const batches = await batchIds(ctx, spec);
  const base = ctx.supabase.from(spec.table).select(`id, ${spec.column}`).limit(50);
  const scoped = batches ? base.in("inventory_id", batches) : base.eq("organization_id", ctx.organizationId);
  const { data, error } = await applySearch(scoped, [spec.column], term);
  if (error) return { ok: false, error: "系統暫時無法完成這項操作，請稍後再試" };
  const rows = (data ?? []) as unknown as Record<string, string>[];
  const exact = rows.filter((r) => String(r[spec.column]).toLowerCase() === term.toLowerCase());
  const matches = exact.length ? exact : rows;
  if (matches.length === 1) return { ok: true, id: matches[0].id };
  if (!matches.length) return { ok: false, error: `找不到「${term}」這個${spec.label}` };
  const names = matches.slice(0, MAX_CHOICES).map((r) => r[spec.column]).join("、");
  return { ok: false, error: `有多個${spec.label}符合「${term}」：${names}。請使用者選擇是哪一個` };
}

/**
 * Where a tool's input holds references: "order_id", "factory_ids[]" (array of references),
 * "items[].inventory_roll_id" (a field in each element).
 */
export type RefPaths = Record<string, RefKind>;

/** The input with every declared reference replaced by its id, or the first resolution error. */
export async function resolveRefs<T extends Record<string, unknown>>(
  ctx: ToolContext, input: T, paths: RefPaths | undefined
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!paths) return { ok: true, data: input };
  const data = structuredClone(input) as Record<string, unknown>;
  for (const [path, kind] of Object.entries(paths)) {
    const nested = path.match(/^(\w+)\[\]\.(\w+)$/);
    const list = path.match(/^(\w+)\[\]$/);
    const targets: { holder: Record<string, unknown> | unknown[]; key: string | number }[] = [];
    if (nested) {
      for (const el of (data[nested[1]] as Record<string, unknown>[] | undefined) ?? []) targets.push({ holder: el, key: nested[2] });
    } else if (list) {
      const arr = (data[list[1]] as unknown[] | undefined) ?? [];
      arr.forEach((_, i) => targets.push({ holder: arr, key: i }));
    } else {
      targets.push({ holder: data, key: path });
    }
    for (const { holder, key } of targets) {
      const value = (holder as Record<string | number, unknown>)[key];
      if (typeof value !== "string") continue;
      const r = await resolveRef(ctx, kind, value);
      if (!r.ok) return r;
      (holder as Record<string | number, unknown>)[key] = r.id;
    }
  }
  return { ok: true, data: data as T };
}
