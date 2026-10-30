/**
 * Product search as the model actually phrases it (src/tools/search.ts): separators between
 * name and color, and a trailing 色. Eval 20261015T0047 regressed on both.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesNameColor, searchTokens } from "../src/tools/search.js";
import { getAllTools } from "../src/tools/index.js";
import type { ToolContext } from "../src/tools/types.js";
import { createFakeSupabase, type Tables } from "../evals/fake-supabase.js";

const USER_ID = "0a000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000001";
const tool = (name: string) => getAllTools().find((t) => t.name === name)!;
const ctxFor = (file: string): ToolContext => {
  const fixtures: Tables = JSON.parse(readFileSync(new URL(`../evals/fixtures/${file}.json`, import.meta.url), "utf8"));
  return { supabase: createFakeSupabase(fixtures, USER_ID).client, userId: USER_ID, organizationId: ORG_ID } as ToolContext;
};

test("a separator on its own is not a search word; one inside a word is kept", () => {
  assert.deepEqual(searchTokens("雲朵眠 - 藍0922"), ["雲朵眠", "藍0922"]);
  assert.deepEqual(searchTokens("40S雙面布 / 藏青"), ["40S雙面布", "藏青"]);
  assert.deepEqual(searchTokens("R-001"), ["R-001"], "roll numbers keep their hyphen");
});

test("name and color match with a separator, without a space, or with a trailing 色", () => {
  for (const term of ["雲朵眠-藍", "雲朵眠藍色", "藍色", "雲朵眠藍", "藍的", "雲朵眠藍色的"]) assert.ok(matchesNameColor(term, "雲朵眠", "藍"), term);
  assert.ok(matchesNameColor("米白色", "棉麻平織", "米白色"), "a color named …色 still matches whole");
  assert.ok(!matchesNameColor("紅色", "雲朵眠", "藍"));
});

test("the phrasings from the regressed eval cases find the product and its stock", async () => {
  const basic = ctxFor("basic");
  const inventory = await tool("get_inventory_summary").run(basic, { search: "雲朵眠 - 藍0922" });
  assert.ok(inventory.ok && (inventory.data as { total_stock: number }[]).some((r) => r.total_stock === 320), "pp-inventory / q-inventory-search");

  const real = ctxFor("real");
  for (const search of ["雲朵眠 - 藍色", "雲朵眠 藍色", "雲朵眠藍色", "雲朵眠 藍的"]) {
    const products = await tool("list_products").run(real, { search });
    assert.ok(products.ok && (products.data as { color: string }[]).some((p) => p.color === "藍"), search);
  }
});
