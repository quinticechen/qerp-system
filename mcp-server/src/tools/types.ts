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

/** Permission keys stored in organization_roles.permissions (same keys the UI uses). */
export const PERMISSION_KEYS = [
  "canViewCustomers", "canCreateCustomers", "canEditCustomers",
  "canViewOrders", "canCreateOrders", "canEditOrders",
  "canViewProducts", "canCreateProducts", "canEditProducts", "canDeleteProducts",
  "canViewInventory", "canCreateInventory", "canEditInventory",
  "canViewPurchases", "canCreatePurchases", "canEditPurchases",
  "canViewShipping", "canCreateShipping", "canEditShipping",
  "canViewFactories", "canCreateFactories", "canEditFactories",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export const ok = (data: unknown): ToolResult => ({ ok: true, data });
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
}

/** Type-erased form stored in the registry; `run` validates raw input before executing. */
export interface RegisteredTool extends ToolMeta {
  input: z.AnyZodObject;
  run(ctx: ToolContext, rawInput: unknown): Promise<ToolResult>;
}

export function defineTool<I extends z.AnyZodObject>(def: ToolDefinition<I>): RegisteredTool {
  const { execute, ...meta } = def;
  return {
    ...meta,
    run: async (ctx, rawInput) => {
      const parsed = def.input.safeParse(rawInput);
      if (!parsed.success) return fail(`參數錯誤：${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("；")}`);
      return execute(ctx, parsed.data);
    },
  };
}

/**
 * Name from an embedded many-to-one relation (e.g. `customers(name)`). Without generated DB
 * types supabase-js infers embeds as arrays, but PostgREST returns a single object at runtime.
 */
export function embeddedName(relation: { name: string } | { name: string }[] | null | undefined): string | undefined {
  return Array.isArray(relation) ? relation[0]?.name : relation?.name;
}
