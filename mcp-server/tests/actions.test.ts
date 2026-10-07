/**
 * Confirming / cancelling drafts (docs/QUERY_AGENT_PHASE0.md P0-5), against the fake database.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confirmAction, cancelAction } from "../src/agent/actions.js";
import { AccessError } from "../src/agent/auth-guard.js";
import { createFakeSupabase, type FakeAccess, type RecordedWrite, type Tables } from "../evals/fake-supabase.js";

const USER_ID = "0a000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000001";
const SESSION_ID = "5e000000-0000-4000-8000-000000000001";
const ACTION_ID = "ac000000-0000-4000-8000-000000000001";

const basic: Tables = JSON.parse(readFileSync(new URL("../evals/fixtures/basic.json", import.meta.url), "utf8"));
const roles: Record<string, FakeAccess> = JSON.parse(readFileSync(new URL("../evals/fixtures/roles.json", import.meta.url), "utf8"));

const inFuture = () => new Date(Date.now() + 10 * 60_000).toISOString();

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    user_id: USER_ID,
    organization_id: ORG_ID,
    session_id: SESSION_ID,
    tool: "create_order",
    payload: { customer_id: "c0000000-0000-4000-8000-000000000003" },
    summary: { title: "建立銷售訂單", fields: [{ label: "客戶", value: "Client name test0922" }] },
    status: "pending",
    result: null,
    error: null,
    expires_at: inFuture(),
    ...overrides,
  };
}

function setup(actionOverrides: Record<string, unknown> = {}, role = "owner") {
  const tables: Tables = {
    ...basic,
    query_sessions: [{ id: SESSION_ID, user_id: USER_ID, organization_id: ORG_ID, title: "對話" }],
    query_messages: [],
    query_pending_actions: [action(actionOverrides)],
  };
  return createFakeSupabase(tables, USER_ID, roles[role]);
}

const orderInserts = (writes: RecordedWrite[]) => writes.filter((w) => w.op === "insert" && w.table === "orders").length;
const sessionMessages = (writes: RecordedWrite[]) =>
  writes.filter((w) => w.op === "insert" && w.table === "query_messages").map((w) => (w.values as { content: string }).content);
const isAccessError = (status: number) => (err: unknown) => err instanceof AccessError && err.status === status;

test("confirm executes the write once and posts the result to the session", async () => {
  const { client, writes } = setup();
  const outcome = await confirmAction(client, ACTION_ID);

  assert.equal(outcome.status, "confirmed");
  assert.equal(orderInserts(writes), 1);
  assert.equal((writes.find((w) => w.table === "orders")?.values as { organization_id: string }).organization_id, ORG_ID);
  assert.match(sessionMessages(writes)[0], /✅ 建立銷售訂單已完成：訂單編號/);
});

test("confirming again returns the same outcome without writing again", async () => {
  const { client, writes } = setup();
  const first = await confirmAction(client, ACTION_ID);
  const second = await confirmAction(client, ACTION_ID);

  assert.deepEqual(second, first);
  assert.equal(orderInserts(writes), 1);
});

test("two simultaneous confirmations write once", async () => {
  const { client, writes } = setup();
  const results = await Promise.allSettled([confirmAction(client, ACTION_ID), confirmAction(client, ACTION_ID)]);

  assert.equal(orderInserts(writes), 1);
  assert.ok(results.some((r) => r.status === "fulfilled" && r.value.status === "confirmed"));
  for (const r of results) {
    if (r.status === "rejected") assert.ok(isAccessError(409)(r.reason), "the loser sees 'in progress', not a second write");
  }
});

test("an expired draft is not executed", async () => {
  const { client, writes } = setup({ expires_at: new Date(Date.now() - 1_000).toISOString() });
  await assert.rejects(confirmAction(client, ACTION_ID), isAccessError(409));
  assert.equal(orderInserts(writes), 0);
  assert.ok(writes.some((w) => w.op === "update" && (w.values as { status?: string }).status === "expired"));
});

test("cancel: pending → cancelled; cancelling twice is fine; a cancelled draft cannot be confirmed", async () => {
  const { client, writes } = setup();
  assert.equal((await cancelAction(client, ACTION_ID)).status, "cancelled");
  assert.equal((await cancelAction(client, ACTION_ID)).status, "cancelled");
  await assert.rejects(confirmAction(client, ACTION_ID), isAccessError(409));
  assert.equal(orderInserts(writes), 0);
});

test("a confirmed action cannot be cancelled", async () => {
  const { client } = setup();
  await confirmAction(client, ACTION_ID);
  await assert.rejects(cancelAction(client, ACTION_ID), isAccessError(409));
});

test("permission removed since drafting: confirm is refused and the draft stays pending", async () => {
  const { client, writes } = setup({}, "accounting");
  await assert.rejects(confirmAction(client, ACTION_ID), isAccessError(403));
  assert.equal(orderInserts(writes), 0);
  assert.ok(!writes.some((w) => w.op === "update" && w.table === "query_pending_actions"));
});

test("a write that fails is recorded as failed, reported, and not retried by confirming again", async () => {
  const { client, writes } = setup({ payload: { customer_id: "c0000000-0000-4000-8000-000000000099" } });
  const outcome = await confirmAction(client, ACTION_ID);

  assert.equal(outcome.status, "failed");
  assert.equal(orderInserts(writes), 0);
  assert.match(sessionMessages(writes)[0], /⚠️ 建立銷售訂單失敗/);
  await assert.rejects(confirmAction(client, ACTION_ID), isAccessError(409));
});

test("another user's action is not found", async () => {
  const { client, writes } = setup({ user_id: "0a000000-0000-4000-8000-000000000099" });
  await assert.rejects(confirmAction(client, ACTION_ID), isAccessError(404));
  await assert.rejects(cancelAction(client, ACTION_ID), isAccessError(404));
  assert.equal(orderInserts(writes), 0);
});
