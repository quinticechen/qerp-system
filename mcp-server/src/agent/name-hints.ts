/**
 * Which records a message names. 「查一下和興」 could be a customer or a factory: the router guessed
 * customer and sent factories, products and shelves to the wrong agent (eval 20261014T1611:
 * pp-create-po, real-factory-03/04, real-customer-03). Before routing, the organization's names
 * are matched against the message, and the matches are given to the router and the sub-agents.
 */

import type { ToolContext } from "../tools/types.js";

type Kind = "customer" | "factory" | "product" | "shelf";

const SOURCES: { kind: Kind; label: string; table: string }[] = [
  { kind: "customer", label: "客戶", table: "customers" },
  { kind: "factory", label: "工廠", table: "factories" },
  { kind: "product", label: "產品", table: "products_new" },
  { kind: "shelf", label: "貨架", table: "warehouses" },
];

/** Names per table read for matching; the master data of one organization is small. */
const MAX_NAMES = 500;
/** A shorter part of a name ("和") matches too much text to mean the record. */
const MIN_MATCH = 2;
const MAX_PER_TERM = 5;

export interface NameMatch {
  /** The part of the message that matched. */
  term: string;
  label: string;
  names: string[];
}

/**
 * The longest start of `name` (at least MIN_MATCH characters) that appears in the message:
 * users shorten names (「永泰」 for 永泰布行), and a product name is often followed by a color.
 */
export function matchedPart(message: string, name: string): string | null {
  const text = message.toLowerCase();
  const n = name.trim().toLowerCase();
  for (let k = n.length; k >= MIN_MATCH; k--) {
    if (text.includes(n.slice(0, k))) return name.trim().slice(0, k);
  }
  return null;
}

export function matchNames(message: string, records: { label: string; names: string[] }[]): NameMatch[] {
  const byTerm = new Map<string, NameMatch>();
  for (const { label, names } of records) {
    for (const name of new Set(names)) {
      const term = matchedPart(message, name);
      if (!term) continue;
      const key = `${label}:${term.toLowerCase()}`;
      const match = byTerm.get(key) ?? { term, label, names: [] };
      if (match.names.length < MAX_PER_TERM) match.names.push(name);
      byTerm.set(key, match);
    }
  }
  // A term inside a longer matched term of the same kind ("永泰" in "永泰布行") adds nothing.
  const matches = [...byTerm.values()];
  return matches.filter((m) => !matches.some((o) => o !== m && o.label === m.label && o.term.length > m.term.length && o.term.includes(m.term)));
}

export async function findNames(ctx: ToolContext, message: string): Promise<NameMatch[]> {
  try {
    const records = await Promise.all(SOURCES.map(async ({ label, table }) => {
      const { data } = await ctx.supabase.from(table).select("name").eq("organization_id", ctx.organizationId).limit(MAX_NAMES);
      return { label, names: ((data ?? []) as { name: string | null }[]).flatMap((r) => (r.name ? [r.name] : [])) };
    }));
    return matchNames(message, records);
  } catch {
    // Routing works without hints.
    return [];
  }
}

/** System-prompt addition; empty when nothing matched. */
export function nameNote(matches: NameMatch[]): string {
  if (!matches.length) return "";
  const lines = matches.map((m) => `- 「${m.term}」：${m.label} ${m.names.join("、")}`);
  return `

訊息中提到的名稱（已在資料庫比對）：
${lines.join("\n")}
- 名稱是客戶、工廠、產品或貨架，以這裡為準`;
}
