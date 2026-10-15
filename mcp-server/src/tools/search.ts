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
/** Separators the model writes between a product and its color ("雲朵眠 - 藍"); never a search word. */
const SEPARATORS = /[-–—_/／|｜·・、，:：]/g;

export function searchTokens(search: string): string[] {
  return search
    .split(/\s+/)
    .map((token) => token.replace(UNSAFE_CHARS, ""))
    // A token that is only a separator would have to match a column and find nothing.
    .filter((token) => token.replace(SEPARATORS, "") !== "");
}

export function applySearch<Q extends OrFilterable<Q>>(query: Q, columns: string[], search?: string): Q {
  if (!search) return query;
  let q = query;
  for (const token of searchTokens(search)) {
    q = q.or(columns.map((column) => `${column}.ilike.%${token}%`).join(","));
  }
  return q;
}

/**
 * F15: users type a product name and its color without a space ("雲朵眠藍", "40S雙面布藏青"), so
 * no column contains the token. A token also matches when it splits into a part of the name
 * followed by a part of the color.
 */
export function matchesNameColor(token: string, name: unknown, color: unknown): boolean {
  const n = String(name ?? "").toLowerCase();
  const c = String(color ?? "").toLowerCase();
  // "雲朵眠-藍" → "雲朵眠藍"; "藍色" also means the color 藍 (but a color named 米白色 still matches whole).
  const whole = token.toLowerCase().replace(SEPARATORS, "");
  const variants = whole.length > 1 && whole.endsWith("色") ? [whole, whole.slice(0, -1)] : [whole];
  return variants.some((t) => {
    if (!t || n.includes(t) || c.includes(t)) return true;
    for (let i = 1; i < t.length; i++) {
      if (n.includes(t.slice(0, i)) && c.includes(t.slice(i))) return true;
    }
    return false;
  });
}

/** Rows fetched when the column search found nothing: the organization's catalog is small. */
const FALLBACK_ROWS = 500;

type Rows<R> = PromiseLike<{ data: R[] | null; error: { message: string } | null }>;

/**
 * Column search first (applySearch); when it finds nothing, the rows without the search, filtered
 * with matchesNameColor. `fetch(search, limit)` builds the query with every other filter.
 */
export async function searchNameColor<R extends Record<string, unknown>>(
  fetch: (search: string | undefined, limit: number) => Rows<R>,
  search: string | undefined,
  limit: number,
  nameColumn: keyof R & string,
  colorColumn: keyof R & string
): Promise<{ data: R[]; error: { message: string } | null }> {
  const first = await fetch(search, limit);
  if (first.error || !search || (first.data ?? []).length) return { data: first.data ?? [], error: first.error };
  const tokens = searchTokens(search);
  const all = await fetch(undefined, FALLBACK_ROWS);
  if (all.error) return { data: [], error: all.error };
  const matched = (all.data ?? []).filter((row) => tokens.every((t) => matchesNameColor(t, row[nameColumn], row[colorColumn])));
  return { data: matched.slice(0, limit), error: null };
}
