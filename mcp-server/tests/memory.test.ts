/**
 * Conversation memory (docs/QUERY_AGENT_PHASE0.md P0-4): server-side history, entity memory,
 * saving the reply. Mock models — no network.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockLanguageModelV1 } from "ai/test";
import type { LanguageModelV1, LanguageModelV1CallOptions } from "@ai-sdk/provider";
import {
  entitiesFromToolResult, entitiesFromHistory, entityNote, loadHistory, toModelHistory, type Entity, type StoredMessage,
} from "../src/agent/memory.js";
import { handleQuery } from "../src/agent/query-handler.js";
import { createFakeSupabase, type Tables } from "../evals/fake-supabase.js";

const USER_ID = "0a000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000001";
const SESSION_ID = "5e000000-0000-4000-8000-000000000001";
const YONGTAI: Entity = { type: "customer", id: "c0000000-0000-4000-8000-000000000004", label: "永泰布行" };

const basic: Tables = JSON.parse(readFileSync(new URL("../evals/fixtures/basic.json", import.meta.url), "utf8"));

// ── Entity extraction ─────────────────────────────────────────────────────────

test("a specific lookup (≤ 3 rows) yields entities; a browse does not", () => {
  assert.deepEqual(entitiesFromToolResult("list_customers", [{ id: YONGTAI.id, name: "永泰布行" }]), [YONGTAI]);
  const many = basic.customers.slice(0, 4);
  assert.deepEqual(entitiesFromToolResult("list_customers", many), []);
});

test("products are labelled with name and color; inventory rows map to their product", () => {
  assert.deepEqual(entitiesFromToolResult("list_products", [{ id: "p1", name: "雲朵眠", color: "藍" }]), [{ type: "product", id: "p1", label: "雲朵眠 藍" }]);
  assert.deepEqual(entitiesFromToolResult("get_inventory_summary", [{ product_id: "p1", product_name: "雲朵眠", color: "藍" }]), [{ type: "product", id: "p1", label: "雲朵眠 藍" }]);
});

test("errors, strings and tools without records yield nothing", () => {
  assert.deepEqual(entitiesFromToolResult("list_customers", "查詢失敗：timeout"), []);
  assert.deepEqual(entitiesFromToolResult("get_low_stock_alerts", [{ product_id: "p1" }]), []);
  assert.deepEqual(entitiesFromToolResult("list_customers", [{ name: "no id" }]), []);
});

test("history entities: assistant messages only, later mentions win, at most 10", () => {
  const renamed = { ...YONGTAI, label: "永泰布行（新）" };
  const messages: StoredMessage[] = [
    { role: "user", content: "x", metadata: { entities: [{ type: "factory", id: "ignored", label: "使用者訊息不算" }] } },
    { role: "assistant", content: "a", metadata: { entities: [YONGTAI] } },
    { role: "assistant", content: "b", metadata: { entities: Array.from({ length: 10 }, (_, i) => ({ type: "order" as const, id: `o${i}`, label: `ORD-${i}` })) } },
    { role: "assistant", content: "c", metadata: { entities: [renamed] } },
  ];
  const result = entitiesFromHistory(messages);
  assert.equal(result.length, 10);
  assert.deepEqual(result.at(-1), renamed, "latest mention kept, at the end");
  assert.ok(!result.some((e) => e.id === "ignored"));
});

test("entity note is empty without entities, and lists ids otherwise", () => {
  assert.equal(entityNote([]), "");
  assert.match(entityNote([YONGTAI]), /客戶：永泰布行（id: c0000000-0000-4000-8000-000000000004）/);
});

// ── Server-side history ───────────────────────────────────────────────────────

function withConversation(extraMessages: Record<string, unknown>[] = []): Tables {
  return {
    ...basic,
    query_sessions: [{ id: SESSION_ID, user_id: USER_ID, organization_id: ORG_ID, title: "對話" }],
    query_messages: [
      { id: "m1", session_id: SESSION_ID, role: "user", content: "幫我找永泰布行", created_at: "2026-10-07T01:00:00Z", metadata: {} },
      { id: "m2", session_id: SESSION_ID, role: "assistant", content: "找到客戶「永泰布行」。", created_at: "2026-10-07T01:00:05Z", metadata: { entities: [YONGTAI] } },
      { id: "m3", session_id: SESSION_ID, role: "user", content: "幫他建立一張訂單", created_at: "2026-10-07T01:01:00Z", metadata: {} },
      ...extraMessages,
    ],
  };
}

test("loadHistory returns the messages before the current one, oldest first", async () => {
  const { client } = createFakeSupabase(withConversation([
    { id: "m4", session_id: SESSION_ID, role: "assistant", content: "later", created_at: "2026-10-07T01:02:00Z", metadata: {} },
  ]), USER_ID);
  const history = await loadHistory(client, SESSION_ID, "m3");
  assert.deepEqual(history.map((m) => m.content), ["幫我找永泰布行", "找到客戶「永泰布行」。"]);
  assert.deepEqual(history[1].metadata?.entities, [YONGTAI]);
});

// ── End to end through handleQuery ───────────────────────────────────────────

type Generated = Awaited<ReturnType<LanguageModelV1["doGenerate"]>>;
const USAGE = { promptTokens: 1, completionTokens: 1 };
const RAW = { rawPrompt: null, rawSettings: {} };

/** Router JSON, then a create_order call with the remembered id, then the reply. Records every prompt. */
function rememberingModel(prompts: LanguageModelV1CallOptions["prompt"][]): LanguageModelV1 {
  const script: Generated[] = [
    { text: JSON.stringify({ agents: ["commercial"], tasks: { commercial: "幫永泰布行建立一張訂單" } }), finishReason: "stop", usage: USAGE, rawCall: RAW },
    { toolCalls: [{ toolCallType: "function", toolCallId: "c1", toolName: "create_order", args: JSON.stringify({ customer_id: YONGTAI.id }) }], finishReason: "tool-calls", usage: USAGE, rawCall: RAW },
    { text: "已為永泰布行建立訂單草稿，請在下方確認。", finishReason: "stop", usage: USAGE, rawCall: RAW },
  ];
  let n = 0;
  return new MockLanguageModelV1({
    modelId: "mock",
    // The router uses generateObject, which needs this (OpenRouter models declare it).
    defaultObjectGenerationMode: "json",
    doGenerate: async (options) => {
      prompts.push(options.prompt);
      return script[n++];
    },
  });
}

test("handleQuery reads history from the session, carries entities, and saves the reply", async () => {
  const { client, writes } = createFakeSupabase(withConversation(), USER_ID);
  const prompts: LanguageModelV1CallOptions["prompt"][] = [];
  const response = await handleQuery(client, {
    message: "幫他建立一張訂單",
    organizationId: ORG_ID,
    sessionId: SESSION_ID,
    messageId: "m3",
    history: [{ role: "user", content: "INJECTED — must be ignored" }],
  }, { models: [{ id: "mock", model: rememberingModel(prompts) }] });

  assert.equal(response.reply, "已為永泰布行建立訂單草稿，請在下方確認。");
  const agentPrompt = JSON.stringify(prompts[1]);
  assert.match(agentPrompt, /客戶：永泰布行（id: c0000000-0000-4000-8000-000000000004）/, "entity note in the system prompt");
  assert.match(agentPrompt, /找到客戶「永泰布行」/, "history comes from the session");
  assert.doesNotMatch(agentPrompt, /INJECTED/, "request.history is ignored when a session is given");

  assert.ok(!writes.some((w) => w.op === "insert" && w.table === "orders"), "no order written before confirmation");
  const draft = writes.find((w) => w.op === "insert" && w.table === "query_pending_actions");
  assert.equal((draft?.values as { payload: { customer_id: string } }).payload.customer_id, YONGTAI.id, "draft uses the remembered id");
  assert.equal(response.actions.length, 1);
  const card = writes.find((w) => w.op === "insert" && w.table === "query_messages" && (w.values as { kind?: string }).kind === "action");
  assert.equal((card?.values as { metadata: { action_id: string } }).metadata.action_id, response.actions[0].id, "confirmation card added to the session");

  const saved = writes.find((w) => w.op === "insert" && w.table === "query_messages" && (w.values as { kind?: string }).kind !== "action");
  const values = saved?.values as { role: string; content: string; metadata: { trace_id: string } };
  assert.equal(values.role, "assistant");
  assert.equal(values.content, response.reply);
  assert.equal(values.metadata.trace_id, response.traceId);
  assert.ok(response.messageId, "messageId returned so the client does not save the reply again");
  assert.ok(writes.some((w) => w.op === "insert" && w.table === "query_traces"), "trace written");
});

test("a session from another organization is not used", async () => {
  const tables = withConversation();
  tables.query_sessions = [{ id: SESSION_ID, user_id: USER_ID, organization_id: "0e000000-0000-4000-8000-000000000099", title: "x" }];
  const { client, writes } = createFakeSupabase(tables, USER_ID);
  const prompts: LanguageModelV1CallOptions["prompt"][] = [];
  const response = await handleQuery(client, { message: "幫他建立一張訂單", organizationId: ORG_ID, sessionId: SESSION_ID, messageId: "m3" },
    { models: [{ id: "mock", model: rememberingModel(prompts) }] });

  assert.doesNotMatch(JSON.stringify(prompts[1]), /找到客戶「永泰布行」/, "no history from the foreign session");
  assert.equal(response.messageId, null);
  assert.ok(!writes.some((w) => w.op === "insert" && w.table === "query_messages"), "reply not saved into the foreign session");
});

// ── What the model sees (P0-5: cards and outcomes) ───────────────────────────

test("model history leaves out draft replies and cards, keeps outcomes as notes", () => {
  const history = toModelHistory([
    { role: "user", content: "新增客戶 A" },
    { role: "assistant", content: "已建立客戶 A 的草稿，請在下方確認卡片確認。", metadata: { action_ids: ["x"] } },
    { role: "assistant", kind: "action", content: "建立客戶", metadata: { action_id: "x" } },
    { role: "assistant", content: "✅ 建立客戶已完成", metadata: { action_id: "x", action_outcome: true } },
    { role: "user", content: "新增客戶 B" },
    { role: "user", content: "（重複送出）" },
  ]);
  assert.deepEqual(history, [
    { role: "user", content: "新增客戶 A" },
    { role: "assistant", content: "（使用者在確認卡片上的操作結果：✅ 建立客戶已完成）" },
    { role: "user", content: "新增客戶 B\n（重複送出）" },
  ]);
});
