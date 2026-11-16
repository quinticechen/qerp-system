import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SubscriptionPatch, SubscriptionRow, SubscriptionStore } from "./webhook.js";

/**
 * The one place this server uses the Supabase service role: the Stripe webhook has no user JWT,
 * and organization_subscriptions is closed to clients. Use it for nothing else.
 */
let admin: SupabaseClient | null = null;

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  admin ??= createClient(url, key, { auth: { persistSession: false } });
  return admin;
}

export const supabaseSubscriptionStore: SubscriptionStore = {
  async get(organizationId) {
    const { data, error } = await adminClient().from("organization_subscriptions").select("*").eq("organization_id", organizationId).maybeSingle();
    if (error) throw new Error(`Reading subscription failed: ${error.message}`);
    return data as SubscriptionRow | null;
  },
  async update(organizationId, patch: SubscriptionPatch) {
    const { error } = await adminClient().from("organization_subscriptions").update(patch).eq("organization_id", organizationId);
    if (error) throw new Error(`Updating subscription failed: ${error.message}`);
  },
};
