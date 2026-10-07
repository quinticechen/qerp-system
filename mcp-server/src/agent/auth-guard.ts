import { SupabaseClient } from "@supabase/supabase-js";
import type { ToolName } from "./permissions.js";
import type { PermissionKey } from "../tools/types.js";
import { getAllTools } from "../tools/index.js";

export class AccessError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 404 | 409) {
    super(message);
  }
}

export interface QueryAccess {
  userId: string;
  organizationId: string;
  permissions: ReadonlySet<PermissionKey>;
  allowedTools: ToolName[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tools whose declared permission is in the set, in registry order. */
export function allowedToolNames(permissions: ReadonlySet<PermissionKey>): ToolName[] {
  return getAllTools().filter((t) => permissions.has(t.permission)).map((t) => t.name);
}

/**
 * Auth Guard — 非 AI 層，hard-coded 權限守門員
 *
 * 權限完全交給資料庫的 user_has_organization_permission()（RLS 也用同一個函式）：
 * 有效成員＋有效角色的 permissions，或組織擁有者（organizations.owner_id）。
 * 不在這裡重寫判斷邏輯，避免 AI 與 UI／RLS 的權限不一致。
 */
export async function authGuard(supabase: SupabaseClient, organizationId: unknown): Promise<QueryAccess> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new AccessError("Invalid or expired JWT", 401);

  if (typeof organizationId !== "string" || !UUID_RE.test(organizationId)) {
    throw new AccessError("organization_id is required", 400);
  }

  const [{ data: membership }, { data: isOwner }] = await Promise.all([
    supabase.from("user_organizations").select("organization_id")
      .eq("user_id", user.id).eq("organization_id", organizationId).eq("is_active", true).maybeSingle(),
    supabase.rpc("is_organization_owner", { _user_id: user.id, _organization_id: organizationId }),
  ]);
  if (!membership && isOwner !== true) throw new AccessError("Not a member of this organization", 403);

  // Only the keys some tool needs — one RPC each, in parallel.
  const neededKeys = [...new Set(getAllTools().map((t) => t.permission))];
  const checks = await Promise.all(neededKeys.map(async (key) => {
    const { data, error } = await supabase.rpc("user_has_organization_permission", {
      _user_id: user.id, _organization_id: organizationId, _permission: key,
    });
    if (error) throw new Error(`Permission check failed (${key}): ${error.message}`);
    return [key, data === true] as const;
  }));
  const permissions = new Set(checks.filter(([, granted]) => granted).map(([key]) => key));

  return {
    userId: user.id,
    organizationId,
    permissions,
    allowedTools: allowedToolNames(permissions),
  };
}
