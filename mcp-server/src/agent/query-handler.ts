import { SupabaseClient } from "@supabase/supabase-js";
import { authGuard } from "./auth-guard.js";
import { routeQuery } from "./router.js";
import type { ConversationMessage } from "./sub-agents.js";

export interface QueryRequest {
  message: string;
  organizationId: unknown;
  history?: ConversationMessage[];
}

export interface QueryResponse {
  reply: string;
  allowedToolCount: number;
}

/**
 * 主入口：接收用戶訊息，完整走完三層流程
 * Layer 1 → Auth Guard（組織成員與權限）
 * Layer 2 → Router Agent
 * Layer 3 → Sub Agents
 */
export async function handleQuery(
  supabase: SupabaseClient,
  request: QueryRequest
): Promise<QueryResponse> {
  const access = await authGuard(supabase, request.organizationId);

  const reply = await routeQuery(
    request.message,
    { supabase, userId: access.userId, organizationId: access.organizationId },
    access.allowedTools,
    request.history ?? []
  );

  return { reply, allowedToolCount: access.allowedTools.length };
}
