/**
 * System prompts from Langfuse with the in-code fallback (src/agent/prompts.ts). fetch is stubbed —
 * no network.
 * Run: bun run test
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setPromptLabel, systemPrompt, type PromptSource } from "../src/agent/prompts.js";

const ENV = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL", "QUERY_PROMPT_LABEL"] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let requests: string[] = [];

function serve(handler: (url: string) => Response | Promise<Response>) {
  requests = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    return handler(url);
  }) as typeof fetch;
}
const prompt = (text: string, version: number) => new Response(JSON.stringify({ type: "text", prompt: text, version }), { status: 200 });

function recorder() {
  const seen: Record<string, PromptSource> = {};
  return { seen, run: { observer: { onPrompt: (name: string, source: PromptSource) => { seen[name] = source; } } } };
}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.LANGFUSE_PUBLIC_KEY = "pk";
  process.env.LANGFUSE_SECRET_KEY = "sk";
  process.env.LANGFUSE_BASE_URL = "https://langfuse.test/";
  delete process.env.QUERY_PROMPT_LABEL;
  // undefined → the production default (a fresh cache for each test).
  setPromptLabel(undefined);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
});

test("without Langfuse configured, the in-code prompt is used", async () => {
  delete process.env.LANGFUSE_PUBLIC_KEY;
  serve(() => prompt("遠端", 1));
  const { seen, run } = recorder();
  assert.equal(await systemPrompt("query-router", "程式內建", run), "程式內建");
  assert.deepEqual(seen, { "query-router": "code" });
  assert.equal(requests.length, 0);
});

test("production reads the `production` label once a minute and reports the version", async () => {
  serve(() => prompt("遠端第 3 版", 3));
  const { seen, run } = recorder();
  assert.equal(await systemPrompt("query-agent-commercial", "程式內建", run), "遠端第 3 版");
  assert.equal(await systemPrompt("query-agent-commercial", "程式內建", run), "遠端第 3 版");
  assert.equal(requests.length, 1, "cached");
  assert.match(requests[0], /\/api\/public\/v2\/prompts\/query-agent-commercial\?label=production$/);
  assert.deepEqual(seen, { "query-agent-commercial": { label: "production", version: 3 } });
});

test("when Langfuse is down, production falls back to the in-code prompt", async () => {
  serve(() => new Response("oops", { status: 503 }));
  const { seen, run } = recorder();
  assert.equal(await systemPrompt("query-router", "程式內建", run), "程式內建");
  assert.deepEqual(seen, { "query-router": "code" });
});

test("an eval that asks for a label fails instead of silently using the in-code prompt", async () => {
  serve(() => new Response("not found", { status: 404 }));
  setPromptLabel("candidate");
  await assert.rejects(systemPrompt("query-router", "程式內建"), /query-router@candidate/);
  setPromptLabel(null);
  assert.equal(await systemPrompt("query-router", "程式內建"), "程式內建", "evals default to the in-code prompt");
});

test("QUERY_PROMPT_LABEL=code keeps a developer's server on the in-code prompts", async () => {
  process.env.QUERY_PROMPT_LABEL = "code";
  serve(() => prompt("遠端", 1));
  assert.equal(await systemPrompt("query-router", "程式內建"), "程式內建");
  assert.equal(requests.length, 0);
});
