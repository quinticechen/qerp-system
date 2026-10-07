/**
 * Single-agent architecture (docs/QUERY_AGENT_PHASE0.md P0-7), with mock models.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockLanguageModelV1 } from "ai/test";
import type { LanguageModelV1, LanguageModelV1CallOptions } from "@ai-sdk/provider";
import { answerQuery } from "../src/agent/answer.js";
import { authGuard } from "../src/agent/auth-guard.js";
import type { Draft } from "../src/tools/types.js";
import { createFakeSupabase, type FakeAccess, type Tables } from "../evals/fake-supabase.js";

type Generated = Awaited<ReturnType<LanguageModelV1["doGenerate"]>>;
const USAGE = { promptTokens: 1, completionTokens: 1 };
const RAW = { rawPrompt: null, rawSettings: {} };
const USER_ID = "0a000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000001";
const fixtures: Tables = JSON.parse(readFileSync(new URL("../evals/fixtures/basic.json", import.meta.url), "utf8"));
const roles: Record<string, FakeAccess> = JSON.parse(readFileSync(new URL("../evals/fixtures/roles.json", import.meta.url), "utf8"));

function recording(calls: LanguageModelV1CallOptions[], script: Generated[]): LanguageModelV1 {
  let n = 0;
  return new MockLanguageModelV1({ modelId: "mock", defaultObjectGenerationMode: "json", doGenerate: async (o) => { calls.push(o); return script[n++]; } });
}

const call = (toolName: string, args: object, id: string) => ({ toolCallType: "function" as const, toolCallId: id, toolName, args: JSON.stringify(args) });

async function setup(role = "owner") {
  const { client, writes } = createFakeSupabase(fixtures, USER_ID, roles[role]);
  const access = await authGuard(client, ORG_ID);
  return { ctx: { supabase: client, userId: access.userId, organizationId: access.organizationId }, allowed: access.allowedTools, writes };
}

const MESSAGE = "新增一張 Client name test0922 客戶的訂單給 Factory 092202 工廠";

test("single agent: one model sees the original message and can use tools from both domains", async () => {
  const { ctx, allowed, writes } = await setup();
  const calls: LanguageModelV1CallOptions[] = [];
  const model = recording(calls, [
    { toolCalls: [call("list_customers", { search: "test0922" }, "1"), call("list_factories", { search: "092202" }, "2")], finishReason: "tool-calls", usage: USAGE, rawCall: RAW },
    { toolCalls: [call("create_order", { customer_id: "c0000000-0000-4000-8000-000000000003" }, "3")], finishReason: "tool-calls", usage: USAGE, rawCall: RAW },
    { text: "已建立草稿，請在下方的確認卡片確認。", finishReason: "stop", usage: USAGE, rawCall: RAW },
  ]);
  const drafts: Draft[] = [];
  const reply = await answerQuery(MESSAGE, ctx, allowed, [], { drafts, models: [{ id: "mock", model }] }, "single");

  assert.match(reply, /確認卡片/);
  assert.equal(drafts.length, 1);
  assert.equal(calls.length, 3, "no router call — every model call is the agent's");
  assert.match(JSON.stringify(calls[0].prompt), new RegExp(MESSAGE), "the user's original message, not a rewritten task");
  const offered = (calls[0].mode as { tools?: { name: string }[] }).tools?.map((t) => t.name) ?? [];
  assert.ok(offered.includes("list_customers") && offered.includes("list_factories") && offered.includes("create_purchase_order"));
  assert.ok(!writes.some((w) => w.op === "insert" && !w.table.startsWith("query_")), "still drafts only");
});

test("single agent: a restricted role gets only its tools, plus the permission note", async () => {
  const { ctx, allowed } = await setup("warehouse");
  const calls: LanguageModelV1CallOptions[] = [];
  const model = recording(calls, [{ text: "目前帳號沒有查看客戶的權限。", finishReason: "stop", usage: USAGE, rawCall: RAW }]);
  await answerQuery("查詢所有客戶", ctx, allowed, [], { models: [{ id: "mock", model }] }, "single");

  const offered = (calls[0].mode as { tools?: { name: string }[] }).tools?.map((t) => t.name) ?? [];
  assert.ok(!offered.includes("list_customers"));
  assert.ok(offered.includes("get_inventory_summary"));
  assert.match(JSON.stringify(calls[0].prompt), /本帳號無法使用的工具：[^"]*list_customers/);
});
