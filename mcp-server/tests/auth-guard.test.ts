/**
 * Permission resolution and organization scoping (docs/QUERY_AGENT_PHASE0.md P0-3).
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authGuard, AccessError } from "../src/agent/auth-guard.js";
import { getAllTools } from "../src/tools/index.js";
import { createFakeSupabase, type FakeAccess, type Tables } from "../evals/fake-supabase.js";

const USER_ID = "0a000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000001";
const OTHER_ORG_ID = "0e000000-0000-4000-8000-000000000099";

const fixtures: Tables = JSON.parse(readFileSync(new URL("../evals/fixtures/basic.json", import.meta.url), "utf8"));
const roles: Record<string, FakeAccess> = JSON.parse(readFileSync(new URL("../evals/fixtures/roles.json", import.meta.url), "utf8"));

function clientFor(role: string, tables: Tables = fixtures) {
  return createFakeSupabase(tables, USER_ID, roles[role]);
}

async function toolsFor(role: string) {
  return new Set((await authGuard(clientFor(role).client, ORG_ID)).allowedTools);
}

test("owner gets every tool", async () => {
  assert.equal((await toolsFor("owner")).size, getAllTools().length);
});

test("accounting is read-only", async () => {
  const tools = await toolsFor("accounting");
  for (const write of getAllTools().filter((t) => t.kind === "write")) {
    assert.ok(!tools.has(write.name), `accounting should not get ${write.name}`);
  }
  assert.ok(tools.has("list_orders"));
});

test("warehouse cannot see customers or factories", async () => {
  const tools = await toolsFor("warehouse");
  assert.ok(!tools.has("list_customers"));
  assert.ok(!tools.has("list_factories"));
  assert.ok(tools.has("get_inventory_summary"));
});

test("sales can look up factories but not create purchase orders", async () => {
  const tools = await toolsFor("sales");
  assert.ok(tools.has("list_factories"));
  assert.ok(!tools.has("create_purchase_order"));
  assert.ok(tools.has("create_order"));
});

test("non-member of the organization is rejected with 403", async () => {
  await assert.rejects(authGuard(clientFor("admin").client, OTHER_ORG_ID), (err: unknown) => err instanceof AccessError && err.status === 403);
});

test("inactive membership is rejected with 403", async () => {
  const inactive = { ...fixtures, user_organizations: [{ organization_id: ORG_ID, user_id: USER_ID, is_active: false }] };
  await assert.rejects(authGuard(clientFor("admin", inactive).client, ORG_ID), (err: unknown) => err instanceof AccessError && err.status === 403);
});

test("missing or malformed organization_id is rejected with 400", async () => {
  for (const orgId of [undefined, "", "not-a-uuid"]) {
    await assert.rejects(authGuard(clientFor("owner").client, orgId), (err: unknown) => err instanceof AccessError && err.status === 400);
  }
});

test("writes are scoped to the selected organization", async () => {
  const { client, writes } = clientFor("owner");
  const access = await authGuard(client, ORG_ID);
  const createOrder = getAllTools().find((t) => t.name === "create_order")!;
  const result = await createOrder.run(
    { supabase: client, userId: access.userId, organizationId: access.organizationId },
    { customer_id: "c0000000-0000-4000-8000-000000000003" }
  );
  assert.ok(result.ok);
  assert.equal((writes[0].values as { organization_id: string }).organization_id, ORG_ID);
});
