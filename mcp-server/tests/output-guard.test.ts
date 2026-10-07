/**
 * Replies never show internal IDs (docs/QUERY_AGENT_PHASE0.md P0-5, F7).
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { redactIds } from "../src/agent/output-guard.js";

const ID = "f0000000-0000-4000-8000-000000000001";

test("removes '(ID: …)' parentheticals in either width", () => {
  assert.equal(redactIds(`* Factory 092202 (ID: ${ID})`), "* Factory 092202");
  assert.equal(redactIds(`客戶：永泰布行（id：${ID}）`), "客戶：永泰布行");
});

test("removes inline 'ID: …' and bare UUIDs, tidying spacing", () => {
  assert.equal(redactIds(`已為您找到 Factory ID: ${ID}。`), "已為您找到 Factory。");
  assert.equal(redactIds(`編號 ${ID.toUpperCase()} 已建立`), "編號 已建立");
});

test("leaves ordinary text, order numbers and line breaks alone", () => {
  const text = "訂單 ORD-20261001-001 已建立\n- Chen\n- 永泰布行";
  assert.equal(redactIds(text), text);
});
