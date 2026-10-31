/**
 * /query when the agent itself fails (QUERY_AGENT_TPM_ALIGNMENT.md §3.4): the user gets a polite
 * reply with no technical detail, the error stays in the trace, and no draft is left behind.
 * Mock models — no network.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockLanguageModelV1 } from "ai/test";
import { AGENT_FAILURE_REPLY, handleQuery } from "../src/agent/query-handler.js";
import { createFakeSupabase, type Tables } from "../evals/fake-supabase.js";

const USER_ID = "0a000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000001";
const fixtures: Tables = JSON.parse(readFileSync(new URL("../evals/fixtures/real.json", import.meta.url), "utf8"));

test("when every model fails, the user gets a polite reply and the error stays in the trace", async () => {
  const { client, writes } = createFakeSupabase(fixtures, USER_ID);
  const broken = new MockLanguageModelV1({
    modelId: "broken",
    defaultObjectGenerationMode: "json",
    doGenerate: async () => { throw new Error("relation \"orders\" does not exist"); },
  });
  const response = await handleQuery(client, { message: "列出訂單", organizationId: ORG_ID }, { models: [{ id: "broken", model: broken }] });

  assert.equal(response.reply, AGENT_FAILURE_REPLY);
  assert.doesNotMatch(response.reply, /relation|orders|500/);
  assert.deepEqual(response.actions, []);
  const trace = writes.find((w) => w.op === "insert" && w.table === "query_traces")?.values as { error?: string } | undefined;
  assert.match(String(trace?.error ?? ""), /relation "orders" does not exist/, "the cause is kept for debugging");
});

test("a failure before the agent (an invalid organization) still fails the request", async () => {
  const { client } = createFakeSupabase(fixtures, USER_ID);
  await assert.rejects(handleQuery(client, { message: "列出訂單", organizationId: "not-an-organization" }));
});

test("the trace records which prompts produced the reply", async () => {
  const { client, writes } = createFakeSupabase(fixtures, USER_ID);
  const script = [
    JSON.stringify({ agents: ["commercial"], tasks: { commercial: "列出訂單" } }),
    "目前有 3 張訂單。",
  ];
  let n = 0;
  const model = new MockLanguageModelV1({
    modelId: "mock",
    defaultObjectGenerationMode: "json",
    doGenerate: async () => ({ text: script[n++], finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1 }, rawCall: { rawPrompt: null, rawSettings: {} } }),
  });
  const response = await handleQuery(client, { message: "列出訂單", organizationId: ORG_ID }, { models: [{ id: "mock", model }] });
  assert.equal(response.reply, "目前有 3 張訂單。");
  const trace = writes.find((w) => w.op === "insert" && w.table === "query_traces")?.values as { prompts?: Record<string, unknown> };
  assert.deepEqual(trace.prompts, { "query-router": "code", "query-agent-commercial": "code" }, "no Langfuse in tests: the in-code prompts");
});
