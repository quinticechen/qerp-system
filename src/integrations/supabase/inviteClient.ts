import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Same project as src/integrations/supabase/client.ts (a generated file we don't
// edit directly). Kept in sync manually — update both if the project ever moves.
const SUPABASE_URL = "https://gyiyedvutcbwzpbcsmjc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5aXllZHZ1dGNid3pwYmNzbWpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTQxNTksImV4cCI6MjA5MTczMDE1OX0.GjjHa-Dbg7KJQxfuteg7jUaKelWVhoqSPNg30DFyG34";

/**
 * A throwaway Supabase client for admin-driven `auth.signUp()` calls.
 *
 * `signUp()` can return an active session for the newly created account. If we
 * ran it through the shared `supabase` client, that would silently replace the
 * currently logged-in admin's session with the new user's — logging the admin
 * out mid-flow. This client never persists or refreshes a session, so it can't
 * affect whichever session is live in the rest of the app.
 */
export const createInviteClient = () =>
  createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
