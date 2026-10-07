import { supabase } from '@/integrations/supabase/client';

/** Base URL of the Query backend (mcp-server). */
export const QUERY_API_URL = import.meta.env.VITE_QUERY_API_URL ?? 'http://localhost:3100';

/** POSTs to the Query backend as the signed-in user; throws with the server's message on failure. */
export async function postQueryApi<T>(path: string, body?: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('未登入，請重新整理頁面');
  }
  const res = await fetch(`${QUERY_API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // not JSON — keep the raw text
    }
    throw new Error(message || `伺服器錯誤 (${res.status})`);
  }
  return res.json() as Promise<T>;
}
