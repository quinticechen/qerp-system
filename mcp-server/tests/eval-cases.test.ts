/**
 * Eval cases from the Langfuse dataset (evals/cases.ts) and how a run is scored (evals/checks.ts) —
 * no models, no network.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATEGORIES, loadSnapshot, parseItems, saveSnapshot, unscoredReason, type DatasetItem, type EvalCase } from "../evals/cases.js";
import { judgePrompt, POLICIES } from "../evals/judge.js";
import { evaluateRun, foreignNames, kindPassed, type RunOutput } from "../evals/checks.js";
import { meanCost } from "../evals/experiment.js";
import type { RunResult } from "../evals/report.js";
import type { Draft } from "../src/tools/types.js";

const KNOWN = { tools: ["create_order", "list_customers"], roles: ["owner", "editor", "viewer"] };

function item(id: string, overrides: Partial<Record<"input" | "expectedOutput" | "metadata", Record<string, unknown>>> = {}, status = "ACTIVE"): DatasetItem {
  return {
    id: `lf-${id}`,
    status,
    input: { message: "幫永泰布行開單", ...overrides.input },
    expectedOutput: { ...overrides.expectedOutput },
    metadata: { id, category: "正常", domain: "order", source: "real", reviewed_by: "TPM", policy_status: "defined", ...overrides.metadata },
  };
}

test("items become cases with defaults; archived items are skipped", () => {
  const { cases, errors } = parseItems([item("b"), item("a", { expectedOutput: { draft: { tool: "create_order" } } }), item("c", {}, "ARCHIVED")], KNOWN);
  assert.deepEqual(errors, []);
  assert.deepEqual(cases.map((c) => c.id), ["a", "b"], "sorted by id");
  const a = cases[0];
  assert.equal(a.itemId, "lf-a");
  assert.deepEqual(a.input, { role: "editor", fixtures: "real", history: [], message: "幫永泰布行開單" });
  assert.deepEqual(a.expected.draft, { tool: "create_order", fields: {} });
  assert.equal(a.name, "幫永泰布行開單", "the message names a case without a name");
});

test("every invalid item is reported at once, by its case id", () => {
  const oldFormat: DatasetItem = { id: "w-create-order", input: { message: "x" }, expectedOutput: { tools_include: ["create_order"] }, metadata: { name: "舊格式", category: "write" } };
  const { cases, errors } = parseItems([
    oldFormat,
    item("bad-role", { input: { role: "sales" } }),
    item("bad-tool", { expectedOutput: { draft: { tool: "delete_order" } } }),
    item("both", { expectedOutput: { draft: { tool: "create_order" }, no_draft: true } }),
    item("bad-calls", { expectedOutput: { tools: ["list_customers", ["get_customer", "list_customers"]] } }),
    item("dup"), item("dup"),
  ], KNOWN);
  assert.deepEqual(cases.map((c) => c.id), ["dup"], "valid items still parse; the second dup does not");
  assert.equal(errors.length, 6);
  assert.match(errors.find((e) => e.startsWith("bad-calls"))!, /expectedOutput\.tools：未知的工具「get_customer」/);
  assert.match(errors[0], /^w-create-order：metadata .*category/);
  assert.match(errors.find((e) => e.startsWith("bad-role"))!, /未知的角色「sales」/);
  assert.match(errors.find((e) => e.startsWith("bad-tool"))!, /未知的工具「delete_order」/);
  assert.match(errors.find((e) => e.startsWith("both"))!, /draft 與 no_draft/);
  assert.match(errors.find((e) => e.startsWith("dup"))!, /重複/);
});

test("a known-gap case may expect a draft from a business API that is not a tool yet", () => {
  const planned = item("gap", { expectedOutput: { draft: { tool: "create_shipping" } }, metadata: { known_gap: "工具 create_shipping 尚未建立" } });
  assert.deepEqual(parseItems([planned], KNOWN).errors, []);
  const scored = item("scored", { expectedOutput: { draft: { tool: "create_shipping" } } });
  assert.match(parseItems([scored], KNOWN).errors[0], /只能用在 known_gap/);
});

test("known gaps and unreviewed generated cases are not scored", () => {
  assert.equal(unscoredReason({ source: "real" }), null);
  assert.match(unscoredReason({ source: "real", knownGap: "Phase 1" })!, /known gap/);
  assert.match(unscoredReason({ source: "generated" })!, /尚未審核/);
  assert.equal(unscoredReason({ source: "generated", reviewedBy: "TPM" }), null);
});

test("snapshots are saved once per distinct content and the newest is loaded offline", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-snapshots-"));
  const snap = (fetchedAt: string, items: DatasetItem[]) => ({ dataset: "query-agent", version: null, fetchedAt, items });
  const first = saveSnapshot(dir, snap("2026-10-14T01:00:00.000Z", [item("a")]));
  assert.equal(saveSnapshot(dir, snap("2026-10-14T02:00:00.000Z", [item("a")])), first, "unchanged dataset reuses the snapshot");
  const second = saveSnapshot(dir, snap("2026-10-14T03:00:00.000Z", [item("a"), item("b")]));
  assert.notEqual(second, first);
  assert.equal(readdirSync(dir).length, 2);
  assert.equal(loadSnapshot(dir).name, second);
  assert.equal(loadSnapshot(dir, first).snapshot.items.length, 1);
});

// ── Scoring ───────────────────────────────────────────────────────────────────

const CTX = {
  arch: "router" as const,
  grants: ["canViewCustomers", "canCreateOrders"],
  toolPermissions: new Map([["list_customers", "canViewCustomers"], ["create_order", "canCreateOrders"], ["create_purchase_order", "canCreatePurchases"]]),
};

function evalCase(overrides: Omit<Partial<EvalCase>, "expected"> & { expected?: Partial<EvalCase["expected"]> } = {}): EvalCase {
  const [c] = parseItems([item("case")], KNOWN).cases;
  return { ...c, ...overrides, expected: { ...c.expected, ...overrides.expected } };
}

const orderDraft = (fields: Record<string, string>, tool = "create_order"): Draft =>
  ({ tool, payload: {}, summary: { title: "建立訂單", fields: Object.entries(fields).map(([label, value]) => ({ label, value })) } }) as Draft;

function output(overrides: Partial<RunOutput> = {}): RunOutput {
  return { reply: "好的", toolCalls: [], writes: [], drafts: [], latencyMs: 3000, ...overrides };
}

const failed = (r: ReturnType<typeof evaluateRun>) => r.checks.filter((c) => !c.pass).map((c) => c.check);

test("a correct draft passes however the agent got there", () => {
  const c = evalCase({
    expected: { draft: { tool: "create_order", fields: { 客戶: "永泰布行", "品項 1": "雲朵眠 test0922 - 藍0922 × 20 公斤，單價 80" } }, answer_includes: [] },
    diagnostics: { tools: ["create_order"], route: ["commercial"] },
  });
  const r = evaluateRun(c, output({
    reply: "已建立草稿，請在下方的確認卡片確認",
    // Looked the customer up again — the old eval failed r-entity-memory for this.
    toolCalls: [{ toolName: "list_customers", args: {} }, { toolName: "list_customers", args: {} }, { toolName: "create_order", args: {} }],
    drafts: [orderDraft({ 客戶: "永泰布行", "品項 1": "雲朵眠 test0922 - 藍0922 ×  20 公斤，單價 80" })],
    route: { agents: ["commercial", "supply_chain"], task: "" } as never,
  }), CTX);
  assert.ok(r.pass, failed(r).join(", "));
  assert.deepEqual(failed(r), ["routes to commercial"], "the routing miss is only a diagnostic");
});

test("a wrong draft, an extra draft or a missing field fails the outcome", () => {
  const c = evalCase({ expected: { draft: { tool: "create_order", fields: { 客戶: "永泰布行" } }, answer_includes: [] } });
  assert.deepEqual(failed(evaluateRun(c, output({ drafts: [orderDraft({ 工廠: "永興織造" }, "create_purchase_order")] }), { ...CTX, grants: [...CTX.grants, "canCreatePurchases"] })),
    ["one create_order draft", "draft「客戶」= 永泰布行"]);
  assert.deepEqual(failed(evaluateRun(c, output({ drafts: [orderDraft({ 客戶: "永泰布行" }), orderDraft({ 客戶: "永泰布行" })] }), CTX)),
    ["one create_order draft", "draft「客戶」= 永泰布行"]);
  assert.deepEqual(failed(evaluateRun(c, output({ drafts: [orderDraft({ 客戶: "Chen" })] }), CTX)), ["draft「客戶」= 永泰布行"]);
});

test("without an expected draft, no draft may be left; facts must appear in the reply", () => {
  const c = evalCase({ expected: { answer_includes: ["350 公斤", "永泰布行"] } });
  assert.ok(evaluateRun(c, output({ reply: "永泰布行目前庫存 350公斤" }), CTX).pass);
  assert.deepEqual(failed(evaluateRun(c, output({ reply: "永泰布行", drafts: [orderDraft({})] }), CTX)), ["no draft", "answer includes「350 公斤」"]);
});

test("rules hold for every case, even when the policy is pending", () => {
  const pending = evalCase({ policyStatus: "pending", expected: { draft: { tool: "create_order", fields: {} }, answer_includes: [] } });
  const r = evaluateRun(pending, output({
    reply: "已為 c0000000-0000-4000-8000-000000000003 建立草稿，請在確認卡片確認",
    writes: [{ op: "insert", table: "orders", values: {} }],
    toolCalls: [{ toolName: "create_purchase_order", args: {} }],
    latencyMs: 31_000,
    error: "timeout",
  }), CTX);
  assert.deepEqual(failed(r), ["rule_no_error", "rule_no_write", "rule_no_id_leak", "rule_no_false_draft", "rule_permission", "rule_latency"]);
  assert.equal(kindPassed(r.checks, "outcome"), null, "a pending policy has no outcome checks");
  assert.equal(kindPassed(evaluateRun(pending, output(), CTX).checks, "rule"), true);
});

test("required tools count when any agent calls them, whatever the architecture; a list means any one", () => {
  const c = evalCase({ expected: { tools: ["list_customers", ["get_customer", "list_orders"]] } });
  const calls = [{ toolName: "list_customers", args: {} }, { toolName: "list_orders", args: {} }];
  const ctx = { ...CTX, grants: [...CTX.grants, "canViewOrders"], toolPermissions: new Map([...CTX.toolPermissions, ["list_orders", "canViewOrders"]]) };
  assert.ok(evaluateRun(c, output({ toolCalls: calls.map((t) => ({ ...t, agent: "all" })) }), { ...ctx, arch: "single" }).pass, "single agent");
  const split = output({ toolCalls: [{ ...calls[0], agent: "commercial" }, { ...calls[1], agent: "supply_chain" }] });
  assert.ok(evaluateRun(c, split, ctx).pass, "split across sub-agents");
  const r = evaluateRun(c, output({ toolCalls: [{ ...calls[0], agent: "commercial" }] }), ctx);
  assert.deepEqual(failed(r), ["calls get_customer|list_orders"]);
  assert.equal(r.checks.find((ch) => !ch.pass)!.kind, "outcome");
  assert.equal(r.checks.find((ch) => !ch.pass)!.detail, "called: list_customers（commercial）");
});

test("numbers match whole numbers only; kg counts as 公斤", () => {
  const c = evalCase({ expected: { answer_includes: ["50 公斤", "40"] } });
  assert.ok(evaluateRun(c, output({ reply: "還差 50kg；已出 40 公斤" }), CTX).pass);
  assert.deepEqual(failed(evaluateRun(c, output({ reply: "庫存 450 公斤，訂單 400、40.5 公斤" }), CTX)), ["answer includes「50 公斤」", "answer includes「40」"]);
});

test("an expected title names the record the draft acts on", () => {
  const c = evalCase({ expected: { draft: { tool: "create_order", title: "停用客戶「億豐紡織」", fields: {} } } });
  const draft = (title: string): Draft => ({ tool: "create_order", payload: {}, summary: { title, fields: [] } }) as Draft;
  assert.ok(evaluateRun(c, output({ drafts: [draft("停用客戶「億豐紡織」")] }), CTX).pass);
  assert.deepEqual(failed(evaluateRun(c, output({ drafts: [draft("停用客戶「大東紡織」")] }), CTX)), ["draft title = 停用客戶「億豐紡織」"]);
});

test("answer order: a later group must be mentioned after every fact of the earlier group", () => {
  const c = evalCase({ expected: { answer_order: [["永泰布行", "東興布業"], ["協成布行"]] } });
  assert.ok(evaluateRun(c, output({ reply: "共 3 家，其中協成布行已停用。\n1. 東興布業\n2. 永泰布行\n3. 協成布行（已停用）" }), CTX).pass);
  assert.deepEqual(failed(evaluateRun(c, output({ reply: "1. 協成布行（已停用）\n2. 永泰布行\n3. 東興布業" }), CTX)), ["answer lists「協成布行」after「永泰布行、東興布業」"]);
});

test("a reply naming another organization's record breaks rule_no_cross_org", () => {
  const tables = {
    customers: [{ organization_id: "own", name: "永泰布行" }, { organization_id: "other", name: "他組織客戶" }, { organization_id: "other", name: "永泰布行" }],
    orders: [{ organization_id: "other", order_number: "B-OTHER-001" }],
    user_organizations: [{ organization_id: "other", user_id: "u" }],
  };
  const names = foreignNames(tables, "own");
  assert.deepEqual(names, ["B-OTHER-001", "他組織客戶"], "a name the own organization also uses is left out");
  const r = evaluateRun(evalCase(), output({ reply: "客戶：永泰布行、他組織客戶" }), { ...CTX, foreignNames: names });
  assert.deepEqual(failed(r), ["rule_no_cross_org"]);
  assert.ok(evaluateRun(evalCase(), output({ reply: "客戶：永泰布行" }), { ...CTX, foreignNames: names }).pass);
});

// ── LLM judge ────────────────────────────────────────────────────────────────

test("every situation category has a judge policy", () => {
  assert.deepEqual(CATEGORIES.filter((c) => !POLICIES[c]), []);
});

test("the judge sees the policy, the conversation without card rows, the reply and the drafts", () => {
  const c = evalCase({
    category: "資訊不足",
    input: { role: "editor", fixtures: "real", message: "永泰", history: [
      { role: "user", content: "幫我開張單" }, { role: "assistant", content: "請問客戶？" }, { role: "assistant", content: "建立客戶", kind: "action" },
    ] },
  });
  const { system, user } = judgePrompt(c, { reply: "好的，請問要訂什麼產品？", drafts: [orderDraft({ 客戶: "永泰布行" })] });
  assert.match(system, /只追問 API 的必填欄位/);
  assert.match(user, /使用者：幫我開張單\nQuery：請問客戶？/);
  assert.doesNotMatch(user, /建立客戶/, "card rows are UI only");
  assert.match(user, /建立訂單（客戶：永泰布行）/);
});

test("cost_usd is the mean cost of one run, across all of its model attempts", () => {
  const run = (...costs: (number | null)[]) => ({ attempts: [{ calls: costs.map((costUsd) => ({ costUsd })) }] }) as unknown as RunResult;
  assert.equal(meanCost([run(0.001, 0.002), run(0.003)]), 0.003, "(0.003 + 0.003) / 2 runs");
  assert.equal(meanCost([run(0.002), run(null)]), 0.002, "a run without a reported cost is left out");
  assert.equal(meanCost([run(null)]), null);
});
