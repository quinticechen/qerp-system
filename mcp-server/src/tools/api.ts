/**
 * Write tools backed by the business API (docs/API.md §2): one database function per task,
 * checking the permission key and organization itself.
 *
 * - draft  → the API with p_dry_run = true; its `summary` is the confirmation card
 * - confirm → the same API with p_dry_run = false
 * The card, the validation and the real write therefore share one implementation.
 */

import { z } from "zod";
import { defineTool, ok, fail, type ActionSummary, type RegisteredTool, type ToolContext, type ToolDefinition } from "./types.js";

/** The result every write API returns (docs/API.md §2.2). */
interface ApiResult {
  dry_run: boolean;
  id: string | null;
  number: string | null;
  summary: ActionSummary;
}

interface ApiError {
  code?: string;
  message?: string;
  hint?: string | null;
}

/** Shown when the failure is not one the API reported (network, unexpected database error). */
const GENERIC_ERROR = "系統暫時無法完成這項操作，請稍後再試";

/**
 * The API's own errors (api_fail) carry a code in `hint` and a message meant for the user
 * (docs/API.md §2.3). Anything else is logged and replaced, so database internals never reach
 * the reply.
 */
export function apiErrorMessage(error: ApiError): string {
  if (error.hint && /^[a-z_]+$/.test(error.hint) && error.message) return error.message;
  console.error("[API] 非預期的錯誤:", error);
  return GENERIC_ERROR;
}

async function callApi(
  ctx: ToolContext,
  rpc: string,
  params: Record<string, unknown>,
  dryRun: boolean
): Promise<{ ok: true; result: ApiResult } | { ok: false; error: string }> {
  const { data, error } = await ctx.supabase.rpc(rpc, { p_organization_id: ctx.organizationId, ...params, p_dry_run: dryRun });
  if (error) return { ok: false, error: apiErrorMessage(error as ApiError) };
  return { ok: true, result: data as ApiResult };
}

/** Drops undefined values so the API applies its own defaults. */
function compact(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
}

interface ApiWriteToolDefinition<I extends z.AnyZodObject>
  extends Omit<ToolDefinition<I>, "kind" | "execute" | "summarize"> {
  /** The API function, e.g. "create_order". */
  rpc: string;
  /** API parameters without p_organization_id / p_dry_run. */
  toParams(input: z.infer<I>): Record<string, unknown>;
}

export function defineApiWriteTool<I extends z.AnyZodObject>(def: ApiWriteToolDefinition<I>): RegisteredTool {
  const { rpc, toParams, ...meta } = def;
  return defineTool<I>({
    ...meta,
    kind: "write",
    summarize: async (ctx, input) => {
      const r = await callApi(ctx, rpc, compact(toParams(input)), true);
      return r.ok ? { ok: true, summary: r.result.summary } : r;
    },
    execute: async (ctx, input) => {
      const r = await callApi(ctx, rpc, compact(toParams(input)), false);
      if (!r.ok) return fail(r.error);
      return ok({ message: `${r.result.summary.title}完成`, id: r.result.id, number: r.result.number });
    },
  });
}
