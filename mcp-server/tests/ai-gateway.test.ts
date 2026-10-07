/**
 * AI Gateway fallback rules (docs/QUERY_AGENT_PHASE0.md P0-6), with mock models — no network.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APICallError } from "ai";
import { MockLanguageModelV1 } from "ai/test";
import type { LanguageModelV1, LanguageModelV1CallOptions } from "@ai-sdk/provider";
import { aiGenerateText, EmptyResponseError, DeadlineExceededError, type GatewayModel } from "../src/agent/ai-gateway.js";
import { runSubAgent } from "../src/agent/sub-agents.js";
import type { ObservedAttempt } from "../src/agent/observer.js";
import { TOOL_GROUPS } from "../src/agent/permissions.js";
import { createGroupTools } from "../src/agent/tool-registry.js";
import type { Draft, ToolContext } from "../src/tools/types.js";
import { createFakeSupabase, type Tables } from "../evals/fake-supabase.js";

type Generated = Awaited<ReturnType<LanguageModelV1["doGenerate"]>>;

const USAGE = { promptTokens: 1, completionTokens: 1 };
const RAW = { rawPrompt: null, rawSettings: {} };

const reply = (text: string): Generated => ({ text, finishReason: "stop", usage: USAGE, rawCall: RAW });
const toolCall = (toolName: string, args: object): Generated => ({
  toolCalls: [{ toolCallType: "function", toolCallId: `call-${toolName}`, toolName, args: JSON.stringify(args) }],
  finishReason: "tool-calls",
  usage: USAGE,
  rawCall: RAW,
});
/** Gemini's MALFORMED_FUNCTION_CALL: no text, no tool calls (F8). */
const malformed = (): Generated => ({ finishReason: "error", usage: USAGE, rawCall: RAW });

/** A model that answers successive calls from a script and counts how often it was called. */
function scripted(id: string, ...steps: (Generated | Error)[]): GatewayModel & { calls: () => number } {
  let n = 0;
  const model = new MockLanguageModelV1({
    modelId: id,
    doGenerate: async () => {
      const step = steps[Math.min(n++, steps.length - 1)];
      if (step instanceof Error) throw step;
      return step;
    },
  });
  return { id, model, calls: () => n };
}

/** Never answers until aborted. Holds the event loop open like a pending HTTP request would
 * (AbortSignal.timeout's timer alone doesn't). */
function hanging(id: string): GatewayModel {
  const model = new MockLanguageModelV1({
    modelId: id,
    doGenerate: (options: LanguageModelV1CallOptions) =>
      new Promise((_, reject) => {
        const keepAlive = setInterval(() => {}, 1_000);
        options.abortSignal?.addEventListener("abort", () => {
          clearInterval(keepAlive);
          reject(options.abortSignal?.reason);
        });
      }),
  });
  return { id, model };
}

const apiError = (statusCode: number) =>
  new APICallError({ message: `HTTP ${statusCode}`, url: "https://example.test", requestBodyValues: {}, statusCode, isRetryable: false });

const PROMPT = { messages: [{ role: "user" as const, content: "hi" }] };

test("empty response (MALFORMED_FUNCTION_CALL) falls back to the next model (F8)", async () => {
  const a = scripted("a", malformed());
  const b = scripted("b", reply("來自 b 的回覆"));
  const attempts: ObservedAttempt[] = [];
  const result = await aiGenerateText(PROMPT, { phase: "test", models: [a, b], observer: { onModelAttempt: (x) => attempts.push(x) } });
  assert.equal(result.text, "來自 b 的回覆");
  assert.ok(attempts[0].error instanceof EmptyResponseError);
  assert.deepEqual(attempts.map((x) => [x.phase, x.modelId, !!x.error]), [["test", "a", true], ["test", "b", false]]);
});

test("provider 5xx falls back", async () => {
  const b = scripted("b", reply("ok"));
  const result = await aiGenerateText(PROMPT, { phase: "test", models: [scripted("a", apiError(502)), b] });
  assert.equal(result.text, "ok");
});

test("rejected API key does not fall back (same key for every model)", async () => {
  const b = scripted("b", reply("ok"));
  await assert.rejects(aiGenerateText(PROMPT, { phase: "test", models: [scripted("a", apiError(401)), b] }), (err) => APICallError.isInstance(err));
  assert.equal(b.calls(), 0);
});

test("when every model fails, the primary model's error is surfaced", async () => {
  await assert.rejects(
    aiGenerateText(PROMPT, { phase: "test", models: [scripted("a", malformed()), scripted("b", apiError(500))] }),
    (err) => err instanceof EmptyResponseError
  );
});

test("an attempt that hangs is aborted and the request stops at its deadline", async () => {
  const b = scripted("b", reply("ok"));
  const started = Date.now();
  await assert.rejects(
    aiGenerateText(PROMPT, { phase: "test", models: [hanging("a"), b], deadline: Date.now() + 200 }),
  );
  assert.ok(Date.now() - started < 2_000, "aborted promptly");
  assert.equal(b.calls(), 0, "no attempt starts after the deadline");
});

test("a slow attempt times out and the next model answers", async () => {
  const result = await aiGenerateText(PROMPT, { phase: "test", models: [hanging("a"), scripted("b", reply("ok"))], attemptTimeoutMs: 100 });
  assert.equal(result.text, "ok");
});

test("deadline already passed: no model is called", async () => {
  const a = scripted("a", reply("ok"));
  await assert.rejects(aiGenerateText(PROMPT, { phase: "test", models: [a], deadline: Date.now() - 1 }), (err) => err instanceof DeadlineExceededError);
  assert.equal(a.calls(), 0);
});

// ── With real tools against the fake database ────────────────────────────────

const USER_ID = "0a000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000001";
const fixtures: Tables = JSON.parse(readFileSync(new URL("../evals/fixtures/basic.json", import.meta.url), "utf8"));
const ALL_TOOLS = [...new Set([...TOOL_GROUPS.commercial, ...TOOL_GROUPS.supply_chain])];

function setup() {
  const fake = createFakeSupabase(fixtures, USER_ID);
  const ctx: ToolContext = { supabase: fake.client, userId: USER_ID, organizationId: ORG_ID };
  return { ctx, writes: fake.writes };
}

test("`default_api.` tool names are repaired instead of aliased (F4)", async () => {
  const { ctx } = setup();
  const tools = createGroupTools(ctx, ALL_TOOLS, "supply_chain", { onDraft: () => {} });
  assert.ok(!Object.keys(tools).some((n) => n.includes(".")), "no dotted tool names are sent to providers");

  const a = scripted("a", toolCall("default_api.list_factories", {}), reply("找到 2 間工廠"));
  const result = await aiGenerateText({ ...PROMPT, tools, maxSteps: 3 }, { phase: "test", models: [a] });
  assert.equal(result.text, "找到 2 間工廠");
  assert.equal((result.steps[0].toolResults as { toolName: string }[])[0].toolName, "list_factories");
});

const CREATE_ORDER = toolCall("create_order", { customer_id: "c0000000-0000-4000-8000-000000000003" });
const businessInserts = (writes: { op: string; table: string }[]) =>
  writes.filter((w) => w.op === "insert" && !w.table.startsWith("query_"));

test("the agent loop never writes: create_order becomes a draft (P0-5)", async () => {
  const { ctx, writes } = setup();
  const drafts: Draft[] = [];
  const text = await runSubAgent("commercial", "建立訂單", ALL_TOOLS, ctx, [], { models: [scripted("a", CREATE_ORDER, reply("已建立草稿"))], drafts });

  assert.equal(text, "已建立草稿");
  assert.deepEqual(businessInserts(writes), [], "no business rows written");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].tool, "create_order");
  assert.deepEqual(drafts[0].summary.fields.find((f) => f.label === "客戶")?.value, "Client name test0922", "card shows the name, not the id");
});

test("a failed attempt's drafts are discarded; only the answering attempt's draft survives", async () => {
  const { ctx, writes } = setup();
  const drafts: Draft[] = [];
  const a = scripted("a", CREATE_ORDER, apiError(502));         // drafts, then the provider fails
  const b = scripted("b", CREATE_ORDER, reply("已建立草稿"));    // re-run drafts again
  const text = await runSubAgent("commercial", "建立訂單", ALL_TOOLS, ctx, [], { models: [a, b], drafts });

  assert.equal(text, "已建立草稿");
  assert.equal(drafts.length, 1, "one card, not two");
  assert.deepEqual(businessInserts(writes), []);
});

test("an invalid draft is reported to the model and not collected", async () => {
  const { ctx } = setup();
  const drafts: Draft[] = [];
  const foreign = toolCall("create_order", { customer_id: "c0000000-0000-4000-8000-000000000099" });
  const a = scripted("a", foreign, reply("找不到此客戶"));
  await runSubAgent("commercial", "建立訂單", ALL_TOOLS, ctx, [], { models: [a], drafts });
  assert.equal(drafts.length, 0, "another organization's customer cannot be drafted");
});

test("a reply that claims a draft without creating one is rejected and the next model answers", async () => {
  const { ctx } = setup();
  const drafts: Draft[] = [];
  const liar = scripted("a", reply("已建立訂單草稿，請在下方的確認卡片確認。"));   // no tool call
  const honest = scripted("b", CREATE_ORDER, reply("已建立草稿，請在下方的確認卡片確認。"));
  const attempts: ObservedAttempt[] = [];
  const text = await runSubAgent("commercial", "建立訂單", ALL_TOOLS, ctx, [], {
    models: [liar, honest], drafts, observer: { onModelAttempt: (x) => attempts.push(x) },
  });

  assert.equal(drafts.length, 1, "the card the reply mentions exists");
  assert.match(text, /確認卡片/);
  assert.equal((attempts[0].error as Error).name, "InvalidReplyError");
});

test("mentioning drafts in a normal answer is fine when no card is promised", async () => {
  const { ctx } = setup();
  const a = scripted("a", reply("目前帳號沒有建立訂單的權限。"));
  assert.equal(await runSubAgent("commercial", "建立訂單", ALL_TOOLS, ctx, [], { models: [a], drafts: [] }), "目前帳號沒有建立訂單的權限。");
});

test("a model that stops silently after drafting still gets the card and a standard reply", async () => {
  const { ctx } = setup();
  const drafts: Draft[] = [];
  const silent = scripted("a", CREATE_ORDER, { finishReason: "stop", usage: USAGE, rawCall: RAW });
  const text = await runSubAgent("commercial", "建立訂單", ALL_TOOLS, ctx, [], { models: [silent], drafts });
  assert.equal(drafts.length, 1);
  assert.match(text, /確認卡片/);
});
