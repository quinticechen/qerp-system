import { SupabaseClient } from "@supabase/supabase-js";
import { getAllowedTools, ToolName } from "./permissions.js";

export interface AuthResult {
  userId: string;
  roles: string[];
  allowedTools: ToolName[];
}

/**
 * Auth Guard — 非 AI 層，hard-coded 權限守門員
 * 從 Supabase 取得用戶角色，產出動態工具清單
 */
export async function authGuard(supabase: SupabaseClient): Promise<AuthResult> {
  // 取得當前用戶身份
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error("Invalid or expired JWT");
  }

  // 查詢用戶在所屬組織中的角色
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  // 查詢組織角色（多角色支援）
  const { data: orgRoles } = await supabase
    .from("user_organization_roles")
    .select("role_name")
    .eq("user_id", user.id);

  // 合併所有角色
  const roles = new Set<string>();

  if (profile?.role) {
    roles.add(profile.role);
  }

  if (orgRoles?.length) {
    orgRoles.forEach((r: any) => r.role_name && roles.add(r.role_name));
  }

  // 若查不到角色，預設給 accounting（最低權限）
  if (roles.size === 0) {
    roles.add("accounting");
  }

  const roleList = Array.from(roles);
  const allowedTools = getAllowedTools(roleList);

  return {
    userId: user.id,
    roles: roleList,
    allowedTools,
  };
}
