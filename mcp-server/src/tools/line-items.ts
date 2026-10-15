/**
 * Item changes for update APIs that take the complete list (update_order, update_purchase_order,
 * update_shipping — docs/API.md §3): a line missing from the list is deleted.
 *
 * The model only describes what changes (lines to add or change, lines to remove); the tool reads
 * the current lines and builds the full list, so a line the model leaves out is kept. The API's
 * dry run still lists every 移除／修改／新增 line on the card before anything is written.
 */

import { refuse, type Refusal } from "./api.js";
import { allInOrganization, type ToolContext } from "./types.js";

type Line = Record<string, unknown>;

/** Lines named by their product, as on the card: 「雲朵眠 - 藍」. */
export const PRODUCT_NAMING = {
  embed: "products_new(name, color)",
  label: (p: Record<string, unknown>) => [p.name, p.color].filter(Boolean).join(" - "),
};

interface LineSource {
  /** Parent table checked against the organization, e.g. "orders". */
  parentTable: string;
  parentId: string;
  /** Shown when the parent is not in this organization. */
  notFound: string;
  table: string;
  parentColumn: string;
  /** Columns sent back to the API for every kept line (including `id`). */
  columns: string[];
  /** The column that identifies a line to the model: product_id or inventory_roll_id. */
  key: string;
  /** How lines are named when the model must pick one: an embedded relation and its label. */
  naming: { embed: string; label: (embedded: Record<string, unknown>) => string };
  /** "訂單", "採購單", "出貨單" — for messages. */
  parentLabel: string;
}

/**
 * Current lines merged with the changes: `upsert` entries replace the given fields of the line
 * with the same key, or add a line; `remove` drops the lines with those keys. An entry without a
 * key changes the only line (「B202610010001 數量改成 50 公斤」); with several lines the model is
 * told which there are, so it asks the user.
 */
export async function mergeLines(
  ctx: ToolContext,
  source: LineSource,
  changes: { upsert?: Line[]; remove?: string[] },
  /** Fields a new line needs, with the label the model passes on to the user. */
  newLineFields: Record<string, string>
): Promise<Line[] | Refusal> {
  if (!(await allInOrganization(ctx, source.parentTable, [source.parentId]))) return refuse(source.notFound);
  const { data, error } = await ctx.supabase
    .from(source.table)
    .select([...source.columns, source.naming.embed].join(", "))
    .eq(source.parentColumn, source.parentId)
    .order("created_at");
  if (error) return refuse("系統暫時無法完成這項操作，請稍後再試");

  const relation = source.naming.embed.replace(/\(.*$/, "");
  const current = (data ?? []) as unknown as Line[];
  const name = (l: Line, i: number) => {
    const embedded = l[relation];
    return embedded && typeof embedded === "object" ? source.naming.label(embedded as Line) : `第 ${i + 1} 項`;
  };
  const remove = new Set(changes.remove ?? []);
  const lines: Line[] = current
    .filter((l) => !remove.has(String(l[source.key])))
    .map(({ [relation]: _named, ...line }) => line);
  for (const raw of changes.upsert ?? []) {
    const change = { ...raw };
    if (change[source.key] === undefined) {
      if (current.length !== 1) {
        return refuse(`此${source.parentLabel}有 ${current.length} 個項目：${current.map(name).join("、")}。請使用者指定要改哪一個`);
      }
      change[source.key] = current[0][source.key];
    }
    const existing = lines.find((l) => l[source.key] === change[source.key]);
    if (existing) {
      Object.assign(existing, Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined)));
      continue;
    }
    const missing = Object.entries(newLineFields).filter(([f]) => change[f] === undefined).map(([, label]) => label);
    if (missing.length) return refuse(`新增的項目缺少：${missing.join("、")}`);
    lines.push(change);
  }
  return lines;
}
