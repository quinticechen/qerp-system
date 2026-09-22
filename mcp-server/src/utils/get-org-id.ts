import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns the user's active organization_id.
 * RLS ensures this only returns organizations the current user belongs to.
 * If the user belongs to multiple orgs, returns the first one.
 */
export async function getUserOrgId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from("user_organizations")
    .select("organization_id")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return data?.organization_id ?? null;
}
