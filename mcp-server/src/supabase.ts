import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY"
  );
}

/**
 * 建立以使用者 JWT 認證的 Supabase client。
 * RLS 會根據 auth.uid() 自動隔離資料，不需要 organization_id filter。
 */
export function createUserClient(userJwt: string): SupabaseClient {
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${userJwt}` },
    },
  });
}
