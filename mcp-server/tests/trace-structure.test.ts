/**
 * The Langfuse trace of a request (src/agent/ai-gateway.ts tracedPhase): one observation per
 * phase — the router and the summary as chains, each sub-agent as an agent — with the model
 * attempts beneath it, named by model, so Langfuse draws router → sub-agents → summary.
 * Run: bun run test
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockLanguageModelV1 } from "ai/test";
import type { LanguageModelV1 } from "@ai-sdk/provider";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { startActiveObservation } from "@langfuse/tracing";
import { answerQuery } from "../src/agent/answer.js";
import { authGuard } from "../src/agent/auth-guard.js";
import { flushTracing, shutdownTracing, startTracing } from "../src/agent/langfuse.js";
import { createFakeSupabase, type FakeAccess, type Tables } from "../evals/fake-supabase.js";

type Generated = Awaited<ReturnType<LanguageModelV1["doGenerate"]>>;
const text = (t: string): Generated => ({ text: t, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1 }, rawCall: { rawPrompt: null, rawSettings: {} } });

const ended: ReadableSpan[] = [];
const collector: SpanProcessor = {
  onStart() {},
  onEnd(span) { ended.push(span); },
  forceFlush: async () => {},
  shutdown: async () => {},
};
startTracing({ environment: "test", sampleRate: 1, mask: false, processor: collector });
after(() => shutdownTracing());

const fixtures: Tables = JSON.parse(readFileSync(new URL("../evals/fixtures/basic.json", import.meta.url), "utf8"));
const roles: Record<string, FakeAccess> = JSON.parse(readFileSync(new URL("../evals/fixtures/roles.json", import.meta.url), "utf8"));

const type = (s: ReadableSpan) => s.attributes["langfuse.observation.type"];
const parentOf = (s: ReadableSpan) => ended.find((p) => p.spanContext().spanId === s.parentSpanContext?.spanId);

test("router, sub-agents and summary are typed observations holding attempts named by model", async () => {
  const { client } = createFakeSupabase(fixtures, "0a000000-0000-4000-8000-000000000001", roles.owner);
  const access = await authGuard(client, "0e000000-0000-4000-8000-000000000001");
  const model = new MockLanguageModelV1({
    modelId: "mock",
    defaultObjectGenerationMode: "json",
    doGenerate: async (o) => {
      const prompt = JSON.stringify(o.prompt);
      if (prompt.includes("路由器")) return text(JSON.stringify({ agents: ["commercial", "warehouse"], tasks: { commercial: "訂單", warehouse: "庫存" } }));
      if (prompt.includes("回覆彙整者")) return text("訂單需要 100 公斤，庫存 60 公斤，不夠出貨。");
      return text("查到的事實：無\n缺少的必填欄位：無\n錯誤：無");
    },
  });

  await startActiveObservation("query", () =>
    answerQuery("這張訂單的布夠不夠出貨", { supabase: client, userId: access.userId, organizationId: access.organizationId },
      access.allowedTools, [], { models: [{ id: "test/model-a", model }] }, "router"));
  await flushTracing();

  const phase = (name: string) => ended.find((s) => s.name === name);
  assert.equal(type(phase("router")!), "chain");
  assert.equal(type(phase("agent:commercial")!), "agent");
  assert.equal(type(phase("agent:warehouse")!), "agent");
  assert.equal(type(phase("summary")!), "chain");
  for (const name of ["router", "agent:commercial", "agent:warehouse", "summary"]) {
    assert.equal(parentOf(phase(name)!)?.name, "query", `${name} sits directly under the request`);
  }
  // The AI SDK's spans for an attempt sit inside their phase and carry the model as functionId.
  const attempts = ended.filter((s) => s.attributes["ai.telemetry.functionId"] === "test/model-a" && s.name === "ai.generateText");
  assert.ok(attempts.length >= 3);
  for (const a of attempts) assert.match(String(parentOf(a)?.name), /^(agent:(commercial|warehouse)|summary)$/);
  assert.equal(phase("summary")!.attributes["langfuse.observation.output"], "訂單需要 100 公斤，庫存 60 公斤，不夠出貨。");
});
