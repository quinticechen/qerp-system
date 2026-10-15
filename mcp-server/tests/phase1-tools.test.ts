/**
 * Phase 1 tools (docs/requirements/QUERY_AGENT_PHASE1.md §3): what each tool sends to its API, item merging for
 * the update APIs that take a complete list, roll lookups inside the organization, and the
 * name+color search (F15). The API calls are recorded, not simulated: these tests check the
 * parameters, the simulated rules are in evals/fake-api.ts.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { getAllTools } from "../src/tools/index.js";
import { TOOL_GROUPS, ROUTABLE_GROUPS } from "../src/agent/permissions.js";
import { matchesNameColor } from "../src/tools/search.js";
import type { ToolContext } from "../src/tools/types.js";
import { createFakeSupabase, type Tables } from "../evals/fake-supabase.js";

const USER_ID = "0a000000-0000-4000-8000-000000000001";
const ORG = "0e000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0e000000-0000-4000-8000-000000000099";

const id = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORDER = id("d", 1);
const FOREIGN_ORDER = id("d", 99);
const PO = id("e", 1);
const SHIPPING = id("b", 1);
const BLUE = id("a", 1);
const WHITE = id("a", 2);
const NEW_PRODUCT = id("a", 3);
const SHELF = id("9", 1);

const TABLES: Tables = {
  customers: [
    { id: id("c", 1), organization_id: ORG, name: "永泰布行" },
    { id: id("c", 2), organization_id: ORG, name: "永泰紡織" },
    { id: id("c", 3), organization_id: ORG, name: "億豐" },
    { id: id("c", 99), organization_id: OTHER_ORG, name: "億豐國際" },
  ],
  factories: [
    { id: id("f", 1), organization_id: ORG, name: "和興染整" },
    { id: id("f", 2), organization_id: ORG, name: "和興織布" },
  ],
  products_new: [
    { id: BLUE, organization_id: ORG, name: "雲朵眠", color: "藍" },
    { id: WHITE, organization_id: ORG, name: "40S雙面布", color: "藏青" },
    { id: id("a", 99), organization_id: OTHER_ORG, name: "雲朵眠", color: "藍" },
  ],
  orders: [
    { id: ORDER, organization_id: ORG, order_number: "B202610090001" },
    { id: FOREIGN_ORDER, organization_id: OTHER_ORG, order_number: "B-OTHER" },
  ],
  order_products: [
    { id: id("1", 1), order_id: ORDER, product_id: BLUE, quantity: 100, unit_price: 50, total_rolls: 4, specifications: null, created_at: "2026-10-09T01:00:00Z", products_new: { name: "雲朵眠", color: "藍" } },
    { id: id("1", 2), order_id: ORDER, product_id: WHITE, quantity: 30, unit_price: 80, total_rolls: null, specifications: { note: "x" }, created_at: "2026-10-09T02:00:00Z", products_new: { name: "40S雙面布", color: "藏青" } },
    { id: id("1", 99), order_id: FOREIGN_ORDER, product_id: id("a", 99), quantity: 1, unit_price: 1, created_at: "2026-10-09T01:00:00Z" },
  ],
  purchase_orders: [{ id: PO, organization_id: ORG, po_number: "P202610090001" }],
  purchase_order_items: [
    { id: id("2", 1), purchase_order_id: PO, product_id: BLUE, ordered_quantity: 200, ordered_rolls: null, unit_price: 40, specifications: null, created_at: "2026-10-09T01:00:00Z" },
  ],
  shippings: [{ id: SHIPPING, organization_id: ORG, shipping_number: "O202610090001" }],
  shipping_items: [
    { id: id("3", 1), shipping_id: SHIPPING, inventory_roll_id: id("4", 1), shipped_quantity: 20, created_at: "2026-10-09T01:00:00Z" },
    { id: id("3", 2), shipping_id: SHIPPING, inventory_roll_id: id("4", 2), shipped_quantity: 25, created_at: "2026-10-09T02:00:00Z" },
  ],
  inventories: [
    { id: id("5", 1), organization_id: ORG },
    { id: id("5", 99), organization_id: OTHER_ORG },
  ],
  inventory_rolls: [
    { id: id("4", 1), inventory_id: id("5", 1), product_id: BLUE, roll_number: "R001", current_quantity: 5, warehouse_id: SHELF, shelf: "B-03", products_new: { name: "雲朵眠", color: "藍" } },
    { id: id("4", 2), inventory_id: id("5", 1), product_id: WHITE, roll_number: "R002", current_quantity: 25, products_new: { name: "40S雙面布", color: "藏青" } },
    { id: id("4", 3), inventory_id: id("5", 1), product_id: BLUE, roll_number: "R003", current_quantity: 0, products_new: { name: "雲朵眠", color: "藍" } },
    { id: id("4", 99), inventory_id: id("5", 99), product_id: id("a", 99), roll_number: "R-OTHER", current_quantity: 9, products_new: { name: "雲朵眠", color: "藍" } },
  ],
  inventory_summary_enhanced: [
    { product_id: BLUE, organization_id: ORG, total_stock: 320 },
  ],
  warehouses: [
    { id: SHELF, organization_id: ORG, name: "一號倉", location: "A", is_active: true },
    { id: id("9", 2), organization_id: ORG, name: "舊倉", location: null, is_active: false },
    { id: id("9", 99), organization_id: OTHER_ORG, name: "他組織倉", location: null, is_active: true },
  ],
};

/** The fake database for reads; every API call is recorded and answered with an empty dry run. */
function setup() {
  const fake = createFakeSupabase(TABLES, USER_ID);
  const calls: { fn: string; params: Record<string, unknown> }[] = [];
  const supabase = {
    ...fake.client,
    rpc: async (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      return { data: { dry_run: true, id: null, number: null, summary: { title: fn, fields: [] } }, error: null };
    },
  };
  return { ctx: { supabase, userId: USER_ID, organizationId: ORG } as unknown as ToolContext, calls };
}

const tool = (name: string) => getAllTools().find((t) => t.name === name)!;

async function draftParams(name: string, input: Record<string, unknown>) {
  const { ctx, calls } = setup();
  const r = await tool(name).draft!(ctx, input);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.p_dry_run, true);
  assert.equal(calls[0].params.p_organization_id, ORG);
  return calls[0];
}

test("every write tool is named after the API it calls, except the Phase 0 update_order_status", () => {
  // The Langfuse cases expect drafts from tools named after their API (docs/API.md §3).
  const writes = getAllTools().filter((t) => t.kind === "write");
  assert.equal(writes.length, 28);
  for (const t of writes) assert.equal(t.api, t.name === "update_order_status" ? "update_order" : t.name);
});

test("each routable group keeps at most 12 tools, and every tool is in a group", () => {
  for (const g of ROUTABLE_GROUPS) assert.ok(TOOL_GROUPS[g].length <= 12, `${g} has ${TOOL_GROUPS[g].length} tools`);
  const grouped = new Set(ROUTABLE_GROUPS.flatMap((g) => TOOL_GROUPS[g]));
  for (const t of getAllTools()) assert.ok(grouped.has(t.name), `${t.name} is in no group`);
});

test("update_order keeps the lines the model did not mention", async () => {
  const call = await draftParams("update_order", {
    order_id: ORDER,
    set_items: [{ product_id: BLUE, quantity: 120 }, { product_id: NEW_PRODUCT, quantity: 10, unit_price: 60 }],
  });
  assert.equal(call.fn, "update_order");
  assert.deepEqual((call.params.p_changes as { items: unknown[] }).items, [
    { id: id("1", 1), product_id: BLUE, quantity: 120, unit_price: 50, total_rolls: 4, specifications: null },
    { id: id("1", 2), product_id: WHITE, quantity: 30, unit_price: 80, total_rolls: null, specifications: { note: "x" } },
    { product_id: NEW_PRODUCT, quantity: 10, unit_price: 60 },
  ]);
});

test("update_order removes only the listed products, and sends no items for a note change", async () => {
  const removed = await draftParams("update_order", { order_id: ORDER, remove_product_ids: [WHITE] });
  assert.deepEqual((removed.params.p_changes as { items: { product_id: string }[] }).items.map((i) => i.product_id), [BLUE]);
  const note = await draftParams("update_order", { order_id: ORDER, note: "急件" });
  assert.deepEqual(note.params.p_changes, { note: "急件" });
});

test("a new line without its required fields is refused before the API is called", async () => {
  const { ctx, calls } = setup();
  const r = await tool("update_order").draft!(ctx, { order_id: ORDER, set_items: [{ product_id: NEW_PRODUCT, quantity: 5 }] });
  assert.deepEqual(r, { ok: false, error: "新增的項目缺少：單價" });
  assert.equal(calls.length, 0);
});

test("item merging refuses another organization's order", async () => {
  const { ctx, calls } = setup();
  const r = await tool("update_order").draft!(ctx, { order_id: FOREIGN_ORDER, remove_product_ids: [BLUE] });
  assert.deepEqual(r, { ok: false, error: "找不到此訂單" });
  assert.equal(calls.length, 0);
});

test("update_purchase_order and update_shipping merge their lines the same way", async () => {
  const po = await draftParams("update_purchase_order", { purchase_order_id: PO, set_items: [{ product_id: BLUE, unit_price: 45 }], expected_arrival_date: "2026-11-01" });
  assert.deepEqual(po.params.p_changes, {
    items: [{ id: id("2", 1), product_id: BLUE, ordered_quantity: 200, ordered_rolls: null, unit_price: 45, specifications: null }],
    expected_arrival_date: "2026-11-01",
  });
  const sh = await draftParams("update_shipping", { shipping_id: SHIPPING, remove_roll_ids: [id("4", 1)], set_items: [{ inventory_roll_id: id("4", 2), shipped_quantity: 24 }] });
  assert.deepEqual(sh.params.p_changes, { items: [{ id: id("3", 2), inventory_roll_id: id("4", 2), shipped_quantity: 24 }] });
});

test("receive_inventory expands roll_count into one roll each", async () => {
  const call = await draftParams("receive_inventory", {
    purchase_order_id: PO,
    rolls: [{ product_id: BLUE, quantity: 25, roll_count: 3, warehouse_id: SHELF }, { product_id: BLUE, quantity: 18, warehouse_id: SHELF, quality: "B" }],
  });
  assert.deepEqual(call.params.p_rolls, [
    { product_id: BLUE, quantity: 25, warehouse_id: SHELF },
    { product_id: BLUE, quantity: 25, warehouse_id: SHELF },
    { product_id: BLUE, quantity: 25, warehouse_id: SHELF },
    { product_id: BLUE, quantity: 18, warehouse_id: SHELF, quality: "B" },
  ]);
  assert.ok(!("p_arrival_date" in call.params), "unset optional parameters are left to the API's defaults");
});

test("product-level tools send the group id; color tools send the color id", async () => {
  const group = id("6", 1);
  assert.deepEqual((await draftParams("set_product_active", { group_id: group, is_active: false })).params,
    { p_organization_id: ORG, p_product_id: group, p_is_active: false, p_dry_run: true });
  assert.deepEqual((await draftParams("update_product_color", { product_id: BLUE, stock_threshold: 50 })).params,
    { p_organization_id: ORG, p_color_id: BLUE, p_changes: { stock_threshold: 50 }, p_dry_run: true });
});

test("update_order_status cannot mark an order shipped", () => {
  assert.ok(!("shipping_status" in tool("update_order_status").input.shape));
});

test("list_inventory_rolls lists only rolls with stock in this organization", async () => {
  const { ctx } = setup();
  const r = await tool("list_inventory_rolls").run(ctx, {});
  assert.ok(r.ok);
  assert.deepEqual((r.data as { roll_number: string }[]).map((x) => x.roll_number), ["R001", "R002"]);
});

test("list_shelves hides inactive shelves unless asked", async () => {
  const { ctx } = setup();
  const active = await tool("list_shelves").run(ctx, {});
  assert.ok(active.ok);
  assert.deepEqual((active.data as { name: string }[]).map((s) => s.name), ["一號倉"]);
  const all = await tool("list_shelves").run(ctx, { include_inactive: true });
  assert.ok(all.ok);
  assert.equal((all.data as unknown[]).length, 2);
});

test("F15: a product name and its color without a space still match", async () => {
  assert.ok(matchesNameColor("雲朵眠藍", "雲朵眠", "藍"));
  assert.ok(matchesNameColor("40S雙面布藏青", "40S雙面布", "藏青"));
  assert.ok(!matchesNameColor("雲朵眠紅", "雲朵眠", "藍"));

  const { ctx } = setup();
  const products = await tool("list_products").run(ctx, { search: "雲朵眠藍" });
  assert.ok(products.ok);
  assert.deepEqual((products.data as { id: string }[]).map((p) => p.id), [BLUE], "only this organization's product");
  const rolls = await tool("list_inventory_rolls").run(ctx, { search: "40S雙面布藏青" });
  assert.ok(rolls.ok);
  assert.deepEqual((rolls.data as { roll_number: string }[]).map((x) => x.roll_number), ["R002"]);
});

test("a call to a tool the user lacks gets the no-permission reply; an unknown tool the generic one", async () => {
  const { replyForUnavailableTool, NO_PERMISSION_REPLY } = await import("../src/agent/sub-agents.js");
  const { UNSUPPORTED_REPLY } = await import("../src/agent/ai-gateway.js");
  assert.equal(replyForUnavailableTool(["list_orders"], "create_shipping"), NO_PERMISSION_REPLY);
  assert.equal(replyForUnavailableTool(["list_orders"], "delete_order"), UNSUPPORTED_REPLY);
  assert.notEqual(replyForUnavailableTool(["create_shipping"], "create_shipping"), NO_PERMISSION_REPLY, "permitted, only in another group");
});

test("references: a number or a name resolves inside the organization", async () => {
  const { resolveRef } = await import("../src/tools/refs.js");
  const { ctx } = setup();
  assert.deepEqual(await resolveRef(ctx, "order", "B202610090001"), { ok: true, id: ORDER });
  assert.deepEqual(await resolveRef(ctx, "roll", "R002"), { ok: true, id: id("4", 2) });
  assert.deepEqual(await resolveRef(ctx, "customer", "億豐"), { ok: true, id: id("c", 3) }, "an exact name wins over a longer one");
  assert.deepEqual(await resolveRef(ctx, "roll", "R-OTHER"), { ok: false, error: "找不到「R-OTHER」這個布卷" }, "another organization's roll");
  assert.deepEqual(await resolveRef(ctx, "order", "B-OTHER"), { ok: false, error: "找不到「B-OTHER」這個訂單" });
  assert.deepEqual(await resolveRef(ctx, "factory", "和興"), { ok: false, error: "有多個工廠符合「和興」：和興染整、和興織布。請使用者選擇是哪一個" });
  assert.deepEqual(await resolveRef(ctx, "shelf", SHELF), { ok: true, id: SHELF }, "a UUID passes through");
});

test("tools take record numbers and names in id parameters", async () => {
  const roll = await draftParams("update_inventory_roll", { roll_id: "R002", quantity: 22, warehouse_id: "一號倉" });
  assert.deepEqual(roll.params, { p_organization_id: ORG, p_roll_id: id("4", 2), p_changes: { quantity: 22, warehouse_id: SHELF }, p_dry_run: true });
  const ship = await draftParams("create_shipping", { order_id: "B202610090001", items: [{ inventory_roll_id: "R001", shipped_quantity: 5 }] });
  assert.deepEqual(ship.params.p_items, [{ inventory_roll_id: id("4", 1), shipped_quantity: 5 }]);
  assert.equal(ship.params.p_order_id, ORDER);

  const { ctx } = setup();
  const orders = await tool("list_orders").run(ctx, { customer_id: "永泰" });
  assert.deepEqual(orders, { ok: false, error: "有多個客戶符合「永泰」：永泰布行、永泰紡織。請使用者選擇是哪一個" });
});

test("the model gets a bad argument back as a message instead of a failed call", async () => {
  const { toAiSdkTools } = await import("../src/tools/adapters.js");
  const { ctx } = setup();
  const tools = toAiSdkTools([tool("get_purchase_order")], ctx, { onDraft: () => {} });
  const result = await tools.get_purchase_order.execute!({ purchase_order_id: "P209901019999" }, { toolCallId: "1", messages: [] });
  assert.equal(result, "找不到「P209901019999」這個採購單");
});

test("list_inventory_rolls filters by shelf name or position", async () => {
  const { ctx } = setup();
  for (const shelf of ["一號倉", "B-03"]) {
    const r = await tool("list_inventory_rolls").run(ctx, { shelf });
    assert.ok(r.ok);
    assert.deepEqual((r.data as { roll_number: string }[]).map((x) => x.roll_number), ["R001"], shelf);
  }
});

test("name hints: which customers, factories and products a message names", async () => {
  const { matchNames, findNames, nameNote } = await import("../src/agent/name-hints.js");
  const records = [
    { label: "客戶", names: ["永泰布行", "億豐"] },
    { label: "工廠", names: ["和興染整", "和興織布"] },
    { label: "產品", names: ["40S雙面布", "雲朵眠"] },
  ];
  assert.deepEqual(matchNames("查一下和興", records), [{ term: "和興", label: "工廠", names: ["和興染整", "和興織布"] }]);
  assert.deepEqual(matchNames("永泰要的 40S雙面布藏青 50公斤", records).map((m) => `${m.label}:${m.term}`), ["客戶:永泰", "產品:40S雙面布"]);
  assert.deepEqual(matchNames("幫我新增一個客戶", records), []);

  const { ctx } = setup();
  const note = nameNote(await findNames(ctx, "順便跟和興下採購單"));
  assert.match(note, /「和興」：工廠 和興染整、和興織布/);
  assert.doesNotMatch(note, /億豐國際/, "only this organization's names");
});

test("a sub-agent gets the user's own message, plus its part when agents share it (F1)", async () => {
  const { subAgentMessage } = await import("../src/agent/router.js");
  assert.equal(subAgentMessage("幫永泰開單，指定和興", "為永泰建立訂單", 1), "幫永泰開單，指定和興");
  assert.equal(subAgentMessage("開單並下採購單", "建立採購單", 2), "開單並下採購單\n\n（這則訊息由多個助理分工處理，你只負責：建立採購單）");
});

test("a line change without a product changes the only line, or lists the lines to pick from", async () => {
  const po = await draftParams("update_purchase_order", { purchase_order_id: "P202610090001", set_items: [{ ordered_quantity: 50 }] });
  assert.deepEqual((po.params.p_changes as { items: unknown[] }).items, [
    { id: id("2", 1), product_id: BLUE, ordered_quantity: 50, ordered_rolls: null, unit_price: 40, specifications: null },
  ], "quantity changed, price kept");

  const { ctx, calls } = setup();
  const r = await tool("update_order").draft!(ctx, { order_id: "B202610090001", set_items: [{ quantity: 50 }] });
  assert.deepEqual(r, { ok: false, error: "此訂單有 2 個項目：雲朵眠 - 藍、40S雙面布 - 藏青。請使用者指定要改哪一個" });
  assert.equal(calls.length, 0);
});

test("receive_inventory takes the purchase order's only product for rolls without one", async () => {
  const call = await draftParams("receive_inventory", { purchase_order_id: "P202610090001", rolls: [{ quantity: 20.5, warehouse_id: "一號倉" }] });
  assert.deepEqual(call.params.p_rolls, [{ product_id: BLUE, quantity: 20.5, warehouse_id: SHELF }]);
});

test("list_products includes stock kilos per color", async () => {
  const { ctx } = setup();
  const r = await tool("list_products").run(ctx, { search: "雲朵眠" });
  assert.ok(r.ok);
  assert.deepEqual((r.data as { stock_kg: number }[]).map((p) => p.stock_kg), [320]);
});
