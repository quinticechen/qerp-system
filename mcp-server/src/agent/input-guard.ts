/**
 * Guardrails enforced in code before any model runs (docs/requirements/QUERY_AGENT_TPM_ALIGNMENT.md
 * §3.3–§3.4): attacks and prompt injection get one fixed reply, and each user may ask at most
 * RATE_LIMIT_PER_MINUTE questions a minute.
 *
 * The attack patterns are deliberately narrow — an ordinary request that mentions deleting or
 * passwords must still reach the agent, whose permissions decide what it may do.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const BLOCKED_INPUT_REPLY = "Query 不能進行這個操作。";
export const RATE_LIMIT_REPLY = "讓 Query 休息一下，請一分鐘後再試。";
export const RATE_LIMIT_PER_MINUTE = 6;

const ATTACK_PATTERNS: RegExp[] = [
  // Prompt injection: overriding or revealing the instructions.
  /\b(ignore|disregard|forget)\b.{0,20}\b(previous|prior|above|earlier|all)\b.{0,20}\b(instructions?|prompts?|rules)\b/i,
  /(忽略|無視|忘記|不要理).{0,10}(之前|先前|以上|上面|前面|所有).{0,8}(指示|指令|規則|設定|提示)/,
  /\bsystem\s*prompt\b|系統提示詞|(顯示|輸出|告訴我|給我看).{0,6}(你的)?(提示詞|系統指令)/i,
  // Credentials.
  /\b(admin|root|database|db)\b.{0,15}\b(password|passwd|credentials?)\b/i,
  /(管理員|系統|資料庫).{0,6}(密碼|金鑰)|\b(api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token)\b/i,
  // SQL and script injection.
  /\b(drop|truncate)\s+table\b|\bdelete\s+from\s+\w+|\bunion\s+select\b|'\s*or\s+'?1'?\s*=\s*'?1/i,
  /<\s*\/?\s*script\b|\bjavascript\s*:|\bon(error|load)\s*=/i,
];

/** Whether a message is an attack the agent must not see. */
export function isBlockedInput(message: string): boolean {
  return ATTACK_PATTERNS.some((re) => re.test(message));
}

/**
 * Whether the user already asked RATE_LIMIT_PER_MINUTE questions in the last minute. Counted from
 * query_traces (one row per answered request), so every server instance sees the same count.
 */
export async function isRateLimited(supabase: SupabaseClient, userId: string, now = Date.now()): Promise<boolean> {
  const since = new Date(now - 60_000).toISOString();
  const { data, error } = await supabase.from("query_traces").select("id")
    .eq("user_id", userId).gte("created_at", since).limit(RATE_LIMIT_PER_MINUTE);
  // A failed count must not block the user.
  if (error) return false;
  return (data ?? []).length >= RATE_LIMIT_PER_MINUTE;
}
