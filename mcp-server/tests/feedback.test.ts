/**
 * Thumbs up/down on a reply (src/agent/feedback.ts). Langfuse is not started, so only the saved
 * rating and the sampling rule are tested here.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseFeedbackValue, setFeedback, wasSent } from "../src/agent/feedback.js";
import { AccessError } from "../src/agent/auth-guard.js";

const MESSAGE = "11111111-1111-4111-8111-111111111111";

function client(result: { data: unknown; error: { message: string; hint?: string } | null }) {
  const calls: { fn: string; args: unknown }[] = [];
  const supabase = { rpc: async (fn: string, args: unknown) => (calls.push({ fn, args }), result) } as unknown as SupabaseClient;
  return { supabase, calls };
}

test("the rating is saved through set_query_message_feedback", async () => {
  const { supabase, calls } = client({ data: { trace_id: "t1", feedback: { value: "down", at: "2026-10-16T00:00:00Z" } }, error: null });
  const result = await setFeedback(supabase, MESSAGE, "down");
  assert.deepEqual(calls, [{ fn: "set_query_message_feedback", args: { p_message_id: MESSAGE, p_value: "down" } }]);
  assert.equal(result.feedback?.value, "down");
});

test("someone else's reply, or no reply, is 404", async () => {
  const { supabase } = client({ data: null, error: { message: "找不到這則回覆", hint: "not_found" } });
  await assert.rejects(setFeedback(supabase, MESSAGE, "up"), (e: unknown) => e instanceof AccessError && e.status === 404);
  await assert.rejects(setFeedback(supabase, "not-a-uuid", "up"), (e: unknown) => e instanceof AccessError && e.status === 404);
});

test("only up, down or null are accepted", () => {
  assert.equal(parseFeedbackValue("up"), "up");
  assert.equal(parseFeedbackValue(null), null);
  assert.throws(() => parseFeedbackValue("meh"), (e: unknown) => e instanceof AccessError && e.status === 400);
});

test("a thumbs-down is rebuilt only when sampling dropped the request", () => {
  const healthy = { status: "ok", fallback_from: null, route: { agents: ["commercial"] }, attempts: [{ phase: "router", model: "m", duration_ms: 1 }] };
  const outside = "ffffffff" + "0".repeat(24);
  const inside = "00000000" + "0".repeat(24);
  assert.equal(wasSent(healthy, outside), false);
  assert.equal(wasSent(healthy, inside), true, "in the 5% sample");
  assert.equal(wasSent({ ...healthy, status: "error" }, outside), true, "errors are always sent");
  assert.equal(wasSent({ ...healthy, fallback_from: "m" }, outside), true, "fallbacks are always sent");
  assert.equal(wasSent({ ...healthy, attempts: [{ phase: "router", model: "m", duration_ms: 1, error: "x" }] }, outside), true);
});
