/**
 * Tool 單一來源的型別定義（docs/QUERY_AGENT_PHASE0.md §4.1）
 *
 * 每個 tool 只用 defineTool() 定義一次，再由 adapters.ts 轉成 AI SDK 與 MCP 格式。
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolName } from "../agent/permissions.js";

/** Per-request context handed to every tool. */
export interface ToolContext {
  /** Authenticated as the end user — RLS applies to every query. */
  supabase: SupabaseClient;
  userId: string;
  /** The organization selected in the UI; every write is scoped to it. */
  organizationId: string;
}

export type ToolDomain =
  | "customer" | "order" | "product" | "purchase" | "receiving"
  | "inventory" | "shipping" | "factory" | "shelf" | "admin";

/**
 * The permission catalog (RBAC R1, docs/PERMISSIONS.md): the keys user_has_organization_permission()
 * answers for. Keys outside it are false for everyone, including the owner.
 */
export const PERMISSION_KEYS = [
  "canViewCustomers", "canCreateCustomers", "canEditCustomers",
  "canViewFactories", "canCreateFactories", "canEditFactories",
  "canViewProducts", "canCreateProducts", "canEditProducts",
  "canViewShelves", "canCreateShelves", "canEditShelves",
  "canViewOrders", "canCreateOrders", "canEditOrders",
  "canViewPurchases", "canCreatePurchases", "canEditPurchases",
  "canViewInventory", "canCreateInventory", "canEditInventory",
  "canViewShipping", "canCreateShipping", "canEditShipping",
  "canViewUsers", "canCreateUsers", "canEditUsers",
  "canViewPermissions",
  "canViewSystemSettings", "canEditSystemSettings",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export const ok = (data: unknown): ToolResult => ({ ok: true, data });

/** What a confirmation card shows — names, never IDs (docs/QUERY_AGENT_PHASE0.md §4.3). */
export interface ActionSummary {
  title: string;
  fields: { label: string; value: string }[];
}

/** A write the model asked for; stored as a pending action and executed only after confirmation. */
export interface Draft {
  tool: ToolName;
  payload: unknown;
  summary: ActionSummary;
}
export const fail = (error: string): ToolResult => ({ ok: false, error });

interface ToolMeta {
  name: ToolName;
  domain: ToolDomain;
  /** Shown to the model — Traditional Chinese. */
  description: string;
  /** `write` tools move to the draft + confirm flow in P0-5. */
  kind: "read" | "write";
  permission: PermissionKey;
}

export interface ToolDefinition<I extends z.AnyZodObject> extends ToolMeta {
  input: I;
  execute(ctx: ToolContext, input: z.infer<I>): Promise<ToolResult>;
  /**
   * Required for `write` tools: validates the input (including that referenced records are in
   * this organization) and describes the change for the confirmation card. Must not write.
   */
  summarize?(ctx: ToolContext, input: z.infer<I>): Promise<{ ok: true; summary: ActionSummary } | { ok: false; error: string }>;
}

/** Type-erased form stored in the registry; `run` and `draft` validate raw input first. */
export interface RegisteredTool extends ToolMeta {
  input: z.AnyZodObject;
  run(ctx: ToolContext, rawInput: unknown): Promise<ToolResult>;
  /** Write tools only: the validated payload and card summary, without writing anything. */
  draft?(ctx: ToolContext, rawInput: unknown): Promise<{ ok: true; draft: Draft } | { ok: false; error: string }>;
}

function parseInput<I extends z.AnyZodObject>(input: I, raw: unknown): { ok: true; data: z.infer<I> } | { ok: false; error: string } {
  const parsed = input.safeParse(raw);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, error: `參數錯誤：${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("；")}` };
}

export function defineTool<I extends z.AnyZodObject>(def: ToolDefinition<I>): RegisteredTool {
  const { execute, summarize, ...meta } = def;
  if (def.kind === "write" && !summarize) throw new Error(`Write tool ${def.name} needs summarize() for the confirmation card`);
  return {
    ...meta,
    run: async (ctx, rawInput) => {
      const parsed = parseInput(def.input, rawInput);
      return parsed.ok ? execute(ctx, parsed.data) : fail(parsed.error);
    },
    draft: summarize && (async (ctx, rawInput) => {
      const parsed = parseInput(def.input, rawInput);
      if (!parsed.ok) return parsed;
      const described = await summarize(ctx, parsed.data);
      return described.ok ? { ok: true, draft: { tool: def.name, payload: parsed.data, summary: described.summary } } : described;
    }),
  };
}

/**
 * Name from an embedded many-to-one relation (e.g. `customers(name)`). Without generated DB
 * types supabase-js infers embeds as arrays, but PostgREST returns a single object at runtime.
 */
export function embeddedName(relation: { name: string } | { name: string }[] | null | undefined): string | undefined {
  return Array.isArray(relation) ? relation[0]?.name : relation?.name;
}

/**
 * True when every id exists in `table` within the context's organization. Writes call this for
 * referenced records: RLS allows any organization the user belongs to, not just the selected one.
 */
export async function allInOrganization(ctx: ToolContext, table: string, ids: readonly string[]): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (!unique.length) return true;
  const { data, error } = await ctx.supabase.from(table).select("id").in("id", unique).eq("organization_id", ctx.organizationId);
  return !error && (data ?? []).length === unique.length;
}
