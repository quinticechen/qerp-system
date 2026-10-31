/**
 * Write tools backed by the business API (src/tools/api.ts) against the simulated APIs.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apiErrorMessage } from "../src/tools/api.js";
import { getAllTools } from "../src/tools/index.js";
import type { ToolContext } from "../src/tools/types.js";
import { createFakeSupabase, type Tables } from "../evals/fake-supabase.js";
import { FAKE_API_NAMES } from "../evals/fake-api.js";

const USER_ID = "0a000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000001";
const fixtures: Tables = JSON.parse(readFileSync(new URL("../evals/fixtures/real.json", import.meta.url), "utf8"));
const tool = (name: string) => getAllTools().find((t) => t.name === name)!;

function setup() {
  const fake = createFakeSupabase(fixtures, USER_ID);
  return { ctx: { supabase: fake.client, userId: USER_ID, organizationId: ORG_ID } as ToolContext, writes: fake.writes };
}

const ORDER = { customer_id: "c1000000-0000-4000-8000-000000000003", items: [{ product_id: "a1000000-0000-4000-8000-000000000001", quantity: 100, unit_price: 50 }], factory_ids: ["f1000000-0000-4000-8000-000000000002"] };

test("every write tool is backed by an API dry run (draft) and the same API for real (confirm)", async () => {
  const { ctx, writes } = setup();
  const drafted = await tool("create_order").draft!(ctx, ORDER);
  assert.ok(drafted.ok);
  assert.equal(drafted.draft.summary.title, "建立訂單", "card title comes from the API");
  assert.deepEqual(drafted.draft.summary.fields, [
    { label: "客戶", value: "億豐紡織" },
    { label: "品項 1", value: "雲朵眠 - 藍 × 100 公斤，單價 50" },
    { label: "指定工廠", value: "順大織廠" },
    { label: "訂單總額", value: "5000" },
  ], "same wording as the database's api_order_fields");
  assert.equal(writes.length, 0, "a draft writes nothing");

  const done = await tool("create_order").run(ctx, ORDER);
  assert.ok(done.ok);
  assert.match((done.data as { number: string }).number, /^B\d{12}$/);
  assert.ok(writes.some((w) => w.op === "rpc" && w.table === "create_order"));
});

test("the API's message reaches the model; its rules decide whether a draft is possible", async () => {
  const { ctx } = setup();
  const duplicate = await tool("create_customer").draft!(ctx, { name: "永泰布行", contact_person: "王", phone: "0912" });
  assert.deepEqual(duplicate, { ok: false, error: "已有同名的客戶「永泰布行」" });
  const noPhone = await tool("create_customer").draft!(ctx, { name: "新布行", contact_person: "王" });
  assert.deepEqual(noPhone, { ok: false, error: "手機或市話至少填一個" });
});

test("only API errors are shown; anything else becomes a generic message", () => {
  assert.equal(apiErrorMessage({ code: "P0002", message: "找不到此客戶", hint: "customer_not_found" }), "找不到此客戶");
  const raw = apiErrorMessage({ code: "XX000", message: 'relation "orders" does not exist', hint: null });
  assert.doesNotMatch(raw, /relation|orders/);
});

test("the API rejects a caller without the permission key", async () => {
  const fake = createFakeSupabase(fixtures, USER_ID, { isOwner: false, grants: ["canViewOrders", "canViewCustomers", "canViewProducts"] });
  const ctx = { supabase: fake.client, userId: USER_ID, organizationId: ORG_ID } as ToolContext;
  const r = await tool("create_order").run(ctx, ORDER);
  assert.deepEqual(r, { ok: false, error: "您的角色沒有權限執行此操作" });
  assert.equal(fake.writes.length, 0);
});

test("a call with a parameter the API lacks fails like PostgREST, and the user sees a generic message", async () => {
  const fake = createFakeSupabase(fixtures, USER_ID);
  const r = await fake.client.rpc("create_order", { p_organization_id: ORG_ID, p_customer: "x", p_items: [], p_dry_run: true });
  assert.equal(r.error?.code, "PGRST202");
  assert.equal(apiErrorMessage(r.error), "系統暫時無法完成這項操作，請稍後再試");
});

test("every write tool's API is simulated, so evals never run a write tool against a missing fake", () => {
  const writes = getAllTools().filter((t) => t.kind === "write");
  assert.ok(writes.length >= 27);
  assert.deepEqual(writes.map((t) => t.api ?? t.name).filter((api) => !FAKE_API_NAMES.has(api)), []);
});

test("an unknown RPC is an error, as in PostgREST", async () => {
  const fake = createFakeSupabase(fixtures, USER_ID);
  const r = await fake.client.rpc("no_such_api", { p_organization_id: ORG_ID });
  assert.equal(r.error?.code, "PGRST202");
});
