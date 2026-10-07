/**
 * Organization isolation: the user may belong to several organizations (RLS allows all of
 * them), so every tool must stay inside ctx.organizationId. Fixtures include a second
 * organization whose rows are the newest / lowest-stock, so a missing filter shows up here.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAllTools } from "../src/tools/index.js";
import type { ToolContext } from "../src/tools/types.js";
import { createFakeSupabase, type Tables } from "../evals/fake-supabase.js";

const USER_ID = "0a000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000001";
const FOREIGN = /0000000000099|他組織|ORD-OTHER|PO-OTHER|SH-OTHER/;

const fixtures: Tables = JSON.parse(readFileSync(new URL("../evals/fixtures/basic.json", import.meta.url), "utf8"));

function setup() {
  const fake = createFakeSupabase(fixtures, USER_ID);
  const ctx: ToolContext = { supabase: fake.client, userId: USER_ID, organizationId: ORG_ID };
  return { ctx, writes: fake.writes };
}

const tool = (name: string) => getAllTools().find((t) => t.name === name)!;

// Broad calls that would return the foreign rows if a filter were missing.
const READ_CALLS: [string, Record<string, unknown>][] = [
  ["list_customers", {}],
  ["list_customers", { search: "他組織" }],
  ["list_orders", {}],
  ["list_products", { search: "藍0922" }],
  ["get_inventory_summary", { search: "藍0922" }],
  ["get_low_stock_alerts", {}],
  ["list_purchase_orders", {}],
  ["list_shippings", {}],
  ["list_factories", {}],
];

test("every read tool is covered by the isolation check", () => {
  const covered = new Set(READ_CALLS.map(([name]) => name));
  const byIdTools = new Set(["get_customer", "get_order", "get_product", "get_purchase_order", "get_shipping"]);
  for (const t of getAllTools().filter((t) => t.kind === "read")) {
    assert.ok(covered.has(t.name) || byIdTools.has(t.name), `${t.name} has no isolation check`);
  }
});

for (const [name, args] of READ_CALLS) {
  test(`${name}(${JSON.stringify(args)}) returns only the selected organization`, async () => {
    const result = await tool(name).run(setup().ctx, args);
    assert.ok(result.ok, JSON.stringify(result));
    assert.doesNotMatch(JSON.stringify(result.data), FOREIGN);
  });
}

test("get_* by id cannot read another organization's record", async () => {
  const foreign: [string, Record<string, string>][] = [
    ["get_customer", { customer_id: "c0000000-0000-4000-8000-000000000099" }],
    ["get_order", { order_id: "d0000000-0000-4000-8000-000000000099" }],
    ["get_product", { product_id: "a0000000-0000-4000-8000-000000000099" }],
    ["get_purchase_order", { purchase_order_id: "e0000000-0000-4000-8000-000000000099" }],
    ["get_shipping", { shipping_id: "b0000000-0000-4000-8000-000000000099" }],
  ];
  for (const [name, args] of foreign) {
    const result = await tool(name).run(setup().ctx, args);
    assert.equal(result.ok, false, `${name} returned a foreign record`);
  }
});

test("writes cannot reference another organization's records", async () => {
  const { ctx, writes } = setup();
  const order = await tool("create_order").run(ctx, { customer_id: "c0000000-0000-4000-8000-000000000099" });
  assert.equal(order.ok, false);
  const po = await tool("create_purchase_order").run(ctx, {
    factory_id: "f0000000-0000-4000-8000-000000000001",
    items: [{ product_id: "a0000000-0000-4000-8000-000000000099", ordered_quantity: 10, unit_price: 5 }],
  });
  assert.equal(po.ok, false);
  const status = await tool("update_order_status").run(ctx, { order_id: "d0000000-0000-4000-8000-000000000099", status: "cancelled" });
  assert.equal(status.ok, false);
  assert.equal(writes.filter((w) => w.op === "insert").length, 0, "no rows inserted");
  assert.ok(!writes.some((w) => w.ids?.includes("d0000000-0000-4000-8000-000000000099")), "foreign order was not updated");
});
