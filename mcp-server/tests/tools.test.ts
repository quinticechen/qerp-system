/**
 * Deterministic checks for the single tool source (docs/QUERY_AGENT_PHASE0.md P0-2).
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getAllTools } from "../src/tools/index.js";
import { toAiSdkTools, registerMcpTools } from "../src/tools/adapters.js";
import { searchTokens } from "../src/tools/search.js";
import type { ToolContext } from "../src/tools/types.js";
import { createFakeSupabase, type Tables } from "../evals/fake-supabase.js";

const EVAL_USER_ID = "0a000000-0000-4000-8000-000000000001";
const EVAL_ORG_ID = "0e000000-0000-4000-8000-000000000001";
const fixtures: Tables = JSON.parse(readFileSync(new URL("../evals/fixtures/basic.json", import.meta.url), "utf8"));

function fakeContext() {
  const fake = createFakeSupabase(fixtures, EVAL_USER_ID);
  const ctx: ToolContext = { supabase: fake.client, userId: EVAL_USER_ID, organizationId: EVAL_ORG_ID };
  return { ctx, writes: fake.writes };
}

async function connectMcp(ctx: ToolContext) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerMcpTools(server, getAllTools(), ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as { type: string; text: string }[];
  return content.map((c) => c.text).join("");
}

test("AI SDK and MCP adapters expose the same tools", async () => {
  const { ctx } = fakeContext();
  const aiNames = Object.keys(toAiSdkTools(getAllTools(), ctx)).filter((n) => !n.startsWith("default_api.")).sort();
  const { tools } = await (await connectMcp(ctx)).listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), aiNames);
  assert.equal(aiNames.length, 17);
});

test("MCP marks read tools read-only and write tools not", async () => {
  const { tools } = await (await connectMcp(fakeContext().ctx)).listTools();
  const readOnly = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint]));
  assert.equal(readOnly.list_customers, true);
  assert.equal(readOnly.create_order, false);
});

test("MCP call runs the shared implementation", async () => {
  const client = await connectMcp(fakeContext().ctx);
  const result = await client.callTool({ name: "list_factories", arguments: { search: "092202" } });
  assert.equal(result.isError, false);
  assert.match(textOf(result), /Factory 092202/);
  assert.doesNotMatch(textOf(result), /永興織造/);
});

test("invalid input is rejected before touching the database", async () => {
  const { ctx, writes } = fakeContext();
  const createOrder = getAllTools().find((t) => t.name === "create_order")!;
  const result = await createOrder.run(ctx, { customer_id: "not-a-uuid" });
  assert.equal(result.ok, false);
  assert.equal(writes.length, 0);
});

test("product search matches name and color across words (F2)", async () => {
  const { ctx } = fakeContext();
  const listProducts = getAllTools().find((t) => t.name === "list_products")!;
  const result = await listProducts.run(ctx, { search: "雲朵眠 test0922 藍0922" });
  assert.ok(result.ok);
  assert.deepEqual((result.data as { color: string }[]).map((p) => p.color), ["藍0922"]);
});

test("inventory search matches product name and color across words (F2)", async () => {
  const { ctx } = fakeContext();
  const summary = getAllTools().find((t) => t.name === "get_inventory_summary")!;
  const result = await summary.run(ctx, { search: "雲朵眠 藍0922" });
  assert.ok(result.ok);
  assert.deepEqual((result.data as { total_stock: number }[]).map((r) => r.total_stock), [320]);
});

test("search tokens drop PostgREST filter syntax", () => {
  assert.deepEqual(searchTokens("  雲朵眠,(藍)  50%  "), ["雲朵眠藍", "50"]);
});
