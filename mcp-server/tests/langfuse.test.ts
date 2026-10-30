/**
 * Production tracing (src/agent/langfuse.ts): de-identification and tail sampling. No network —
 * the sampler forwards to a recording processor.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { inSample, maskText, sensitiveValues, TailSamplingProcessor } from "../src/agent/langfuse.js";

test("phone numbers, e-mail addresses, contact people and addresses are masked", () => {
  assert.equal(maskText("請打 0912-345-678 或 (02)2345-6789，傳真 02 2345 6790"), "請打 [電話] 或 [電話]，傳真 [電話]");
  assert.equal(maskText("+886 912 345 678"), "[電話]");
  assert.equal(maskText("寄到 amy.lin@example.com.tw"), "寄到 [Email]");
  assert.equal(
    maskText('{"name":"大華紡織","contact_person":"林小姐","address":"台北市中山區 1 號","phone":"02-2345-6789"}'),
    '{"name":"大華紡織","contact_person":"[聯絡人]","address":"[地址]","phone":"[電話]"}'
  );
  // Tool results inside the AI SDK's message JSON are escaped once more.
  assert.equal(maskText('"{\\"contact_person\\":\\"王先生\\"}"'), '"{\\"contact_person\\":\\"[聯絡人]\\"}"');
  assert.equal(maskText('{"address":null}'), '{"address":null}');
});

test("company names, order numbers, dates, quantities and ids are kept", () => {
  const kept = [
    "大華紡織的訂單 SO-20261016-001",
    "PO-0012345678",
    "2026-10-16 出貨 1200 公尺",
    "0e000000-0000-4000-8000-000000000001",
    "單價 0.85 元",
  ];
  for (const text of kept) assert.equal(maskText(text), text);
});

test("contact people and addresses from tool results are masked where the reply repeats them", () => {
  const known = sensitiveValues('{"contact_person":"陳大文","address":"台中市西區 5 號"}');
  assert.equal(maskText("陳大文（台中市西區 5 號）- 0912-111-222", known), "[聯絡人]（[地址]）- [電話]");
});

test("sampling is decided by the trace id", () => {
  assert.equal(inSample("00000000aaaaaaaaaaaaaaaaaaaaaaaa", 0.05), true);
  assert.equal(inSample("ffffffffaaaaaaaaaaaaaaaaaaaaaaaa", 0.05), false);
  assert.equal(inSample("ffffffffaaaaaaaaaaaaaaaaaaaaaaaa", 1), true);
  const ids = Array.from({ length: 2000 }, (_, i) => (i * 2_147_483).toString(16).padStart(8, "0").slice(-8) + "0".repeat(24));
  const share = ids.filter((id) => inSample(id, 0.05)).length / ids.length;
  assert.ok(share > 0.03 && share < 0.07, `about 5%: ${share}`);
});

// ── Tail sampling ──

const SAMPLED = "00000000" + "1".repeat(24);
const NOT_SAMPLED = "ffffffff" + "1".repeat(24);

function recording(): SpanProcessor & { ended: string[] } {
  const ended: string[] = [];
  return {
    ended,
    onStart() {},
    onEnd(span: ReadableSpan) { ended.push(span.name); },
    forceFlush: async () => {},
    shutdown: async () => {},
  };
}

function span(traceId: string, spanId: string, name: string, opts: { error?: boolean; attributes?: Record<string, unknown> } = {}): ReadableSpan {
  return {
    name,
    spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
    status: { code: opts.error ? SpanStatusCode.ERROR : SpanStatusCode.OK },
    attributes: { ...(opts.attributes ?? {}) },
  } as unknown as ReadableSpan;
}

test("a healthy request outside the sample is dropped whole; one inside it is sent whole", () => {
  const inner = recording();
  const sampler = new TailSamplingProcessor(inner, 0.05, false);
  sampler.register(NOT_SAMPLED, "root");
  sampler.onEnd(span(NOT_SAMPLED, "a", "ai.generateText"));
  sampler.onEnd(span(NOT_SAMPLED, "root", "query"));
  sampler.onEnd(span(NOT_SAMPLED, "late", "late child"));
  assert.deepEqual(inner.ended, []);

  sampler.register(SAMPLED, "root2");
  sampler.onEnd(span(SAMPLED, "b", "ai.generateText"));
  assert.deepEqual(inner.ended, [], "held until the request ends");
  sampler.onEnd(span(SAMPLED, "root2", "query"));
  sampler.onEnd(span(SAMPLED, "late2", "late child"));
  assert.deepEqual(inner.ended, ["ai.generateText", "query", "late child"]);
});

test("a failed or degraded request is always sent", () => {
  const inner = recording();
  const sampler = new TailSamplingProcessor(inner, 0, false);
  sampler.register(NOT_SAMPLED, "root");
  sampler.onEnd(span(NOT_SAMPLED, "a", "ai.generateText", { error: true }));
  sampler.onEnd(span(NOT_SAMPLED, "root", "query"));
  assert.deepEqual(inner.ended, ["ai.generateText", "query"]);

  const other = "eeeeeeee" + "2".repeat(24);
  sampler.register(other, "r");
  sampler.keep(other);
  sampler.onEnd(span(other, "r", "query"));
  assert.deepEqual(inner.ended.slice(2), ["query"]);
});

test("unregistered traces (eval items) pass straight through, and masking edits the attributes", () => {
  const inner = recording();
  const sampler = new TailSamplingProcessor(inner, 0, true);
  const s = span(NOT_SAMPLED, "x", "experiment-item-run", { attributes: { "ai.prompt.messages": "電話 0912345678", tokens: 12 } });
  sampler.onEnd(s);
  assert.deepEqual(inner.ended, ["experiment-item-run"]);
  assert.deepEqual(s.attributes, { "ai.prompt.messages": "電話 [電話]", tokens: 12 });
  sampler.onStart({} as Span, {} as never);
});

test("a sent request is masked with the contacts any of its spans read", () => {
  const inner = recording();
  const sampler = new TailSamplingProcessor(inner, 1, true);
  sampler.register(SAMPLED, "root");
  const tool = span(SAMPLED, "t", "list_customers", { attributes: { "ai.toolCall.result": '[{"name":"大華","contact_person":"林小姐"}]' } });
  const root = span(SAMPLED, "root", "query", { attributes: { "langfuse.observation.output": "大華的聯絡人是林小姐" } });
  sampler.onEnd(tool);
  sampler.onEnd(root);
  assert.equal(root.attributes["langfuse.observation.output"], "大華的聯絡人是[聯絡人]");
  assert.equal(tool.attributes["ai.toolCall.result"], '[{"name":"大華","contact_person":"[聯絡人]"}]');
});
