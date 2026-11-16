/**
 * Query's monthly allowance per organization (docs/requirements/PRICING_AND_BILLING.md §3).
 * Read with the user's JWT through get_organization_entitlement(). If the lookup itself fails,
 * Query keeps answering: a billing problem should never take the assistant down.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const NOT_ACTIVATED_REPLY = "這個組織還沒開通，開通後就能使用 Query。可以到「方案與價格」選擇方案，或申請免費試用，我們會盡快與您聯繫。";
export const QUOTA_REACHED_REPLY = "這個月的 Query 使用次數已經用完了，下個月會自動恢復。需要更多次數，可以請擁有者或管理員升級方案。";

/** The reply to send instead of answering, or null when the organization may ask. */
export async function quotaReply(supabase: SupabaseClient, organizationId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_organization_entitlement", { _organization_id: organizationId });
  if (error || !data) {
    if (error && error.code !== "PGRST202") console.warn("[billing] entitlement lookup failed:", error.message);
    return null;
  }
  const entitlement = data as { status: string; query_messages_per_month: number; query_messages_used: number };
  if (entitlement.status === "pending") return NOT_ACTIVATED_REPLY;
  // The question being answered is already saved (the app writes it before calling /query), so it's in the count.
  if (entitlement.query_messages_used > entitlement.query_messages_per_month) return QUOTA_REACHED_REPLY;
  return null;
}
