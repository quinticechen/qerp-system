import { SupabaseClient } from "@supabase/supabase-js";
import { authGuard } from "./auth-guard.js";
import { routeQuery } from "./router.js";
import type { ConversationMessage } from "./sub-agents.js";

export interface QueryRequest {
  message: string;
  history?: ConversationMessage[];
}

export interface QueryResponse {
  reply: string;
  roles: string[];
  allowedToolCount: number;
}

/**
 * 主入口：接收用戶訊息，完整走完三層流程
 * Layer 1 → Auth Guard
 * Layer 2 → Router Agent
 * Layer 3 → Sub Agents
 */
export async function handleQuery(
  supabase: SupabaseClient,
  request: QueryRequest
): Promise<QueryResponse> {
  // Layer 1: Auth Guard — 取得用戶權限，產出可用工具清單
  const { roles, allowedTools } = await authGuard(supabase);

  // Layer 2 & 3: Router → Sub Agents
  const reply = await routeQuery(
    request.message,
    allowedTools,
    supabase,
    request.history ?? []
  );

  return {
    reply,
    roles,
    allowedToolCount: allowedTools.length,
  };
}
