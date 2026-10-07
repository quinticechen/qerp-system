/**
 * Keyword search shared by list tools.
 *
 * The model often sends several words at once ("雲朵眠 藍0922" = product name + color).
 * Matching the whole string against each column never finds anything, so the search is
 * split on whitespace and every word must match at least one of the columns.
 *
 * Tool descriptions intentionally don't explain this: even short added clauses in tool
 * descriptions made gemini-2.5-flash-lite return MALFORMED_FUNCTION_CALL (eval 2026-10-07).
 * Change descriptions only with an eval run.
 */

interface OrFilterable<Q> {
  or(filters: string): Q;
}

// Characters that are syntax in PostgREST `or=(...)` filters or LIKE wildcards.
const UNSAFE_CHARS = /[,()%*\\]/g;

export function searchTokens(search: string): string[] {
  return search
    .split(/\s+/)
    .map((token) => token.replace(UNSAFE_CHARS, ""))
    .filter(Boolean);
}

export function applySearch<Q extends OrFilterable<Q>>(query: Q, columns: string[], search?: string): Q {
  if (!search) return query;
  let q = query;
  for (const token of searchTokens(search)) {
    q = q.or(columns.map((column) => `${column}.ilike.%${token}%`).join(","));
  }
  return q;
}
