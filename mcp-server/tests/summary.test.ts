/**
 * One reply from several sub-agents (src/agent/summary.ts, docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md §8),
 * with mock models that answer by role: router, sub-agent or summary.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockLanguageModelV1 } from "ai/test";
import type { LanguageModelV1, LanguageModelV1CallOptions } from "@ai-sdk/provider";
import { answerQuery } from "../src/agent/answer.js";
import { authGuard } from "../src/agent/auth-guard.js";
import { fallbackReply } from "../src/agent/summary.js";
import type { Draft } from "../src/tools/types.js";
import { createFakeSupabase, type FakeAccess, type Tables } from "../evals/fake-supabase.js";

type Generated = Awaited<ReturnType<LanguageModelV1["doGenerate"]>>;
const USAGE = { promptTokens: 1, completionTokens: 1 };
const RAW = { rawPrompt: null, rawSettings: {} };
const USER_ID = "0a000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000001";
const fixtures: Tables = JSON.parse(readFileSync(new URL("../evals/fixtures/real.json", import.meta.url), "utf8"));
const roles: Record<string, FakeAccess> = JSON.parse(readFileSync(new URL("../evals/fixtures/roles.json", import.meta.url), "utf8"));

const text = (t: string): Generated => ({ text: t, finishReason: "stop", usage: USAGE, rawCall: RAW });
const route = (agents: string[]): Generated => text(JSON.stringify({ agents, tasks: Object.fromEntries(agents.map((a) => [a, `${a} 的部分`])) }));

type Role = "router" | "summary" | "commercial" | "warehouse";

/** Answers each call by the role its system prompt shows; records the prompts per role. */
function byRole(answers: Partial<Record<Role, (o: LanguageModelV1CallOptions) => Generated>>) {
  const seen: Partial<Record<Role, string[]>> = {};
  const model = new MockLanguageModelV1({
    modelId: "mock",
    defaultObjectGenerationMode: "json",
    doGenerate: async (o) => {
      const prompt = JSON.stringify(o.prompt);
      const role: Role = prompt.includes("路由器") ? "router" : prompt.includes("回覆彙整者") ? "summary"
        : prompt.includes("商務管理") ? "commercial" : "warehouse";
      (seen[role] ??= []).push(prompt);
      const answer = answers[role];
      if (!answer) throw new Error(`unexpected ${role} call`);
      return answer(o);
    },
  });
  return { seen, models: [{ id: "mock", model }] };
}

async function ctx() {
  const { client } = createFakeSupabase(fixtures, USER_ID, roles.owner);
  const access = await authGuard(client, ORG_ID);
  return { tool: { supabase: client, userId: access.userId, organizationId: access.organizationId }, allowed: access.allowedTools };
}

test("two sub-agents report to the summary step, which writes the only reply", async () => {
  const { tool, allowed } = await ctx();
  const { seen, models } = byRole({
    router: () => route(["commercial", "warehouse"]),
    commercial: () => text("查到的事實：訂單 B202610010001 要 100 公斤\n缺少的必填欄位：無\n錯誤：無"),
    warehouse: () => text("查到的事實：40S雙面布 - 藏青 庫存 60 公斤\n缺少的必填欄位：無\n錯誤：無"),
    summary: () => text("訂單需要 100 公斤，目前庫存 60 公斤，還差 40 公斤，不夠出貨。"),
  });
  const reply = await answerQuery("這張訂單的布夠不夠出貨", tool, allowed, [], { models, drafts: [] }, "router");

  assert.equal(reply, "訂單需要 100 公斤，目前庫存 60 公斤，還差 40 公斤，不夠出貨。");
  assert.equal(seen.summary?.length, 1);
  assert.match(seen.summary![0], /庫存 60 公斤/, "the summary sees every sub-agent's report");
  assert.match(seen.summary![0], /訂單 B202610010001/);
  assert.match(seen.commercial![0], /交給彙整步驟/, "sub-agents know their reply is not shown to the user");
});

test("a single sub-agent answers the user itself — no summary call", async () => {
  const { tool, allowed } = await ctx();
  const { seen, models } = byRole({
    router: () => route(["commercial"]),
    commercial: () => text("目前有 3 位客戶。"),
  });
  const reply = await answerQuery("有幾個客戶", tool, allowed, [], { models }, "router");
  assert.equal(reply, "目前有 3 位客戶。");
  assert.equal(seen.summary, undefined);
  assert.doesNotMatch(seen.commercial![0], /交給彙整步驟/);
});

test("the summary may not point to a confirmation card when nothing was drafted", async () => {
  const { tool, allowed } = await ctx();
  const drafts: Draft[] = [];
  const { models } = byRole({
    router: () => route(["commercial", "warehouse"]),
    commercial: () => text("查到的事實：無\n缺少的必填欄位：單價\n錯誤：無"),
    warehouse: () => text("查到的事實：無\n缺少的必填欄位：無\n錯誤：無"),
    summary: () => text("已建立草稿，請在下方的確認卡片確認。"),
  });
  const reply = await answerQuery("開一張訂單並出貨", tool, allowed, [], { models, drafts }, "router");
  // Every model attempt is rejected, so the reports are shown instead of a false claim.
  assert.doesNotMatch(reply, /確認卡片/);
  assert.match(reply, /單價/);
  assert.equal(drafts.length, 0);
});

test("a failed sub-agent is reported as unfinished, the others' results still count", async () => {
  const { tool, allowed } = await ctx();
  const { seen, models } = byRole({
    router: () => route(["commercial", "warehouse"]),
    commercial: () => text("查到的事實：目前有 3 位客戶\n缺少的必填欄位：無\n錯誤：無"),
    warehouse: () => { throw new Error("provider down"); },
    summary: () => text("目前有 3 位客戶；庫存的部分這次沒有完成，請稍後再試。"),
  });
  const reply = await answerQuery("客戶有幾個、庫存多少", tool, allowed, [], { models }, "router");
  assert.match(reply, /庫存的部分這次沒有完成/);
  assert.match(seen.summary![0], /處理失敗/);
});

test("without the summary, each report is shown under its group", () => {
  const reply = fallbackReply([
    { group: "commercial", task: "t", report: "A", drafts: [], toolErrors: [] },
    { group: "warehouse", task: "t", failed: true },
  ]);
  assert.match(reply, /客戶與訂單\*\*\nA/);
  assert.match(reply, /發生錯誤/);
});
