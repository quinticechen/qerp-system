/**
 * Eval report metrics, gates, baseline comparison and the Langfuse payload — no models, no network.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckResult } from "../evals/checks.js";
import {
  compareReports, computeMetrics, evaluateGates, findBaseline, logRow, modelSummary, percentile, wilson,
  type CaseInfo, type EvalReport, type RunResult,
} from "../evals/report.js";
import { buildCaseSpans, buildScores, hexId } from "../evals/langfuse.js";

const CASES: CaseInfo[] = [
  { id: "q-a", itemId: "item-q-a", name: "查詢 A", category: "正常", domain: "order", expectsDraft: false },
  { id: "p-a", itemId: "item-p-a", name: "權限 A", category: "沒有權限", domain: "order", expectsDraft: false },
  { id: "w-a", itemId: "item-w-a", name: "建單 A", category: "正常", domain: "order", expectsDraft: true },
  { id: "w-gap", itemId: "item-w-gap", name: "已知限制", category: "正常", domain: "order", expectsDraft: true, unscored: "known gap：Phase 1" },
];

const rule = (pass = true): CheckResult => ({ kind: "rule", check: "rule_no_error", pass });
const outcome = (pass: boolean): CheckResult => ({ kind: "outcome", check: "no draft", pass });

function run(caseId: string, n: number, pass: boolean, extra: Partial<RunResult> = {}): RunResult {
  return {
    caseId, run: n, pass, reply: `回覆 ${caseId} ${n}`, routeFromFallback: false, toolCalls: [], writes: [], drafts: [],
    modelErrors: [], latencyMs: 1000 * n, startedAt: 0, attempts: [], steps: [],
    checks: [rule(), outcome(pass), { kind: "diagnostic", check: "routes to commercial", pass }],
    ...extra,
  };
}

const call = (costUsd: number | null) => ({ startedAt: 0, durationMs: 100, inputTokens: 100, outputTokens: 10, costUsd });

function report(id: string, results: RunResult[], overrides: Partial<EvalReport> = {}): EvalReport {
  const metrics = computeMetrics(CASES, results);
  return {
    version: 3, id, label: id, createdAt: "2026-10-14T00:00:00.000Z", runs: 3, minPass: 0.66,
    manifest: { arch: "router", models: { router: ["lite"], "agent:commercial": ["lite"] }, hashes: { "prompt.router": "aaaa1111" } },
    dataset: { name: "query-agent", version: null, snapshot: "s.json" }, dbCheck: "passed",
    cases: CASES, metrics, gates: evaluateGates(metrics), results, ...overrides,
  };
}

test("cost per completed task divides every call's cost, failed runs included, by the passing runs", () => {
  const attempt = (costs: (number | null)[]) => [{ phase: "router", modelId: "lite", startedAt: 0, durationMs: 300, calls: costs.map(call) }];
  const results = [
    run("q-a", 1, true, { attempts: attempt([0.001, 0.002]) }),
    run("q-a", 2, false, { attempts: attempt([0.003]) }),
    run("p-a", 1, true, { attempts: attempt([null]) }),
    run("w-gap", 1, false, { attempts: attempt([1]) }), // not scored: not counted
  ];
  const m = computeMetrics(CASES, results);
  assert.ok(Math.abs(m.totalCostUsd! - 0.006) < 1e-12);
  assert.ok(Math.abs(m.costPerCompletedTask! - 0.003) < 1e-12);
  assert.equal(m.taskCompletion, 2 / 3);
  assert.deepEqual(m.byCategory, { 沒有權限: 1, 正常: 0.5 });
  assert.deepEqual(m.byDomain, { order: 2 / 3 });
  assert.deepEqual(m.phaseLatencyMs.router, { p50: 300, p90: 300 });
  assert.equal(m.avgInputTokens, 133);
});

test("rules count every case, scored or not; outcome and write completion only scored ones", () => {
  const results = [
    run("w-a", 1, true),
    run("w-a", 2, false, { checks: [rule(false), outcome(true)] }),
    run("w-gap", 1, false, { checks: [rule(false), outcome(false)] }),
  ];
  const m = computeMetrics(CASES, results);
  assert.equal(m.rules, 1 / 3, "the unscored case's broken rule counts");
  assert.equal(m.outcome, 1, "outcome of scored runs only");
  assert.equal(m.writeCompletion, 0.5);
});

test("the LLM judge is averaged over scored runs, per category, and never decides a run", () => {
  const m = computeMetrics(CASES, [
    run("q-a", 1, true, { judge: { score: 1, reason: "ok" } }),
    run("p-a", 1, true, { judge: { score: 0.5, reason: "沒有引導" } }),
    run("w-gap", 1, true, { judge: { score: 0, reason: "unscored" } }),
    run("q-a", 2, false, { judge: null }),
  ]);
  assert.equal(m.policyJudge, 0.75);
  assert.deepEqual(m.policyJudgeByCategory, { 正常: 1, 沒有權限: 0.5 });
  assert.equal(m.taskCompletion, 2 / 3, "judge scores do not change pass/fail");
});

test("without cost data the cost metrics are empty, not zero", () => {
  const m = computeMetrics(CASES, [run("q-a", 1, true)]);
  assert.equal(m.totalCostUsd, null);
  assert.equal(m.costPerCompletedTask, null);
});

test("gates: rules, permissions and writes must be 100%, average latency at most 10 s", () => {
  const gates = evaluateGates(computeMetrics(CASES, [run("q-a", 1, true), run("p-a", 1, true), run("p-a", 2, false)]));
  assert.deepEqual(gates.map((g) => [g.id, g.pass]), [["overall", false], ["rules", true], ["permissions", false], ["latency", true]]);
  assert.ok(!gates.some((g) => g.id === "write"), "no case expecting a draft, no write gate");
  const slow = evaluateGates(computeMetrics(CASES, [run("q-a", 11, true)]));
  assert.deepEqual(slow.find((g) => g.id === "latency"), { id: "latency", label: "平均延遲", unit: "ms", value: 11_000, max: 10_000, pass: false });
});

test("routing and tool choice are diagnostics: a run passes without them, and they feed the confusion table", () => {
  const confused = run("q-a", 1, true, {
    toolCalls: [{ toolName: "list_customers", args: {} }],
    checks: [rule(), outcome(true), { kind: "diagnostic", check: "calls list_factories", pass: false }],
  });
  const m = computeMetrics(CASES, [confused]);
  assert.equal(m.taskCompletion, 1);
  assert.equal(m.toolSelection, 0);
  assert.deepEqual(m.toolConfusion, [{ expected: "list_factories", called: "list_customers", count: 1 }]);
});

test("the confidence interval uses the number of scored cases", () => {
  const [lo, hi] = wilson(0.85, 100);
  assert.ok(Math.abs(lo - 0.767) < 0.005 && Math.abs(hi - 0.907) < 0.005, `${lo}–${hi}`);
  const m = computeMetrics(CASES, [run("q-a", 1, true), run("q-a", 2, true), run("p-a", 1, true)]);
  assert.deepEqual(m.taskCompletionCI, wilson(1, 2));
});

test("percentile picks the nearest rank", () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(percentile([], 90), 0);
});

test("comparison lists regressions, fixes and what changed in the configuration", () => {
  const before = report("before", [run("q-a", 1, true), run("p-a", 1, false), run("w-gap", 1, false)]);
  const after = report("after", [run("q-a", 1, false), run("p-a", 1, true), run("w-gap", 1, true)], {
    manifest: { arch: "router", models: { router: ["lite"], "agent:commercial": ["flash", "lite"] }, hashes: { "prompt.router": "aaaa1111" } },
  });
  const c = compareReports(before, after);
  assert.deepEqual(c.regressed, ["q-a"]);
  assert.deepEqual(c.fixed, ["p-a"], "unscored cases are neither");
  assert.deepEqual(c.changed, ["models.agent:commercial: lite → flash, lite"]);
});

test("the baseline is the latest full, database-checked v3 run with the same setup, else the latest such run", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-reports-"));
  const lite = { arch: "router" as const, models: { router: ["lite"], "agent:commercial": ["lite"] }, hashes: {} };
  const flash = { ...lite, models: { router: ["lite"], "agent:commercial": ["flash"] } };
  const save = (r: EvalReport | (Omit<EvalReport, "version"> & { version: 2 })) => writeFileSync(join(dir, `${r.id}.json`), JSON.stringify(r));
  save(report("20261001T0000-lite", [run("q-a", 1, true)], { manifest: lite }));
  save(report("20261002T0000-flash", [run("q-a", 1, true)], { manifest: flash }));
  save(report("20261003T0000-lite-filtered", [run("q-a", 1, true)], { manifest: lite, filter: "q-" }));
  save(report("20261004T0000-lite-unchecked", [run("q-a", 1, true)], { manifest: lite, dbCheck: "skipped" }));
  save({ ...report("20261005T0000-lite-v2", [run("q-a", 1, true)], { manifest: lite }), version: 2 });

  assert.equal(findBaseline(dir, { id: "now", manifest: lite })?.id, "20261001T0000-lite");
  assert.equal(findBaseline(dir, { id: "now", manifest: { ...lite, arch: "single", models: { "agent:all": ["x"] } } })?.id, "20261002T0000-flash");
});

test("Langfuse spans: one trace per case linked to its dataset item, deterministic IDs", () => {
  const results = [
    run("q-a", 1, true, {
      startedAt: 1_000_000,
      attempts: [{ phase: "agent:commercial", modelId: "lite", startedAt: 1_000_100, durationMs: 500, calls: [call(0.0001)] }],
      steps: [{ agent: "commercial", at: 1_000_400, toolCalls: [{ toolName: "list_customers", args: { search: "Chen" } }] }],
    }),
  ];
  const r = report("20261014T0100-test", results);
  const spans = buildCaseSpans(r, CASES[0], undefined, "dataset-1");
  const traceId = hexId("20261014T0100-test:q-a", 32);
  assert.ok(spans.every((s) => s.traceId === traceId));
  const attr = (name: string, key: string) =>
    spans.find((s) => s.name === name)?.attributes.find((a) => a.key === key)?.value;

  const root = spans.find((s) => !s.parentSpanId)!;
  assert.equal(root.name, "eval:q-a");
  assert.deepEqual(attr("eval:q-a", "langfuse.experiment.id"), { stringValue: "20261014T0100-test" });
  assert.deepEqual(attr("eval:q-a", "langfuse.experiment.item.id"), { stringValue: "item-q-a" }, "the Langfuse item id, not the case id");
  assert.deepEqual(attr("eval:q-a", "langfuse.experiment.item.root_observation_id"), { stringValue: root.spanId });
  assert.deepEqual(attr("agent:commercial · lite", "langfuse.observation.type"), { stringValue: "generation" });
  assert.deepEqual(attr("agent:commercial · lite", "langfuse.observation.cost_details"), { stringValue: '{"total":0.0001}' });
  assert.deepEqual(attr("list_customers", "langfuse.observation.type"), { stringValue: "tool" });
  assert.equal(spans.find((s) => s.name === "run 1")!.startTimeUnixNano, "1000000000000");

  assert.deepEqual(buildCaseSpans(r, CASES[0], undefined, "dataset-1"), spans, "same report → same spans");
});

test("Langfuse scores: pass_rate, rules and outcome for every case, passed only for scored cases", () => {
  const r = report("x", [run("q-a", 1, true), run("q-a", 2, false), run("w-gap", 1, false)]);
  const scores = buildScores(r) as { name: string; value: number; comment?: string }[];
  assert.deepEqual(scores.map((s) => [s.name, s.value]), [
    ["pass_rate", 0.5], ["rules", 1], ["outcome", 0.5], ["passed", 0],
    ["pass_rate", 0], ["rules", 1], ["outcome", 0],
  ]);
  assert.match(scores[0].comment!, /run 2：no draft/);
  assert.doesNotMatch(scores[0].comment!, /routes to/, "diagnostics are not failures");
});

test("experiment log row: primary model per phase, gates, regressions and an empty decision cell", () => {
  const manifest = {
    arch: "router" as const, hashes: {},
    models: { router: ["google/gemini-2.5-flash-lite"], "agent:commercial": ["google/gemini-2.5-flash", "x"], "agent:supply_chain": ["google/gemini-2.5-flash"] },
  };
  assert.equal(modelSummary(manifest), "router: gemini-2.5-flash-lite；commercial、supply_chain: gemini-2.5-flash");
  const r = report("20261014T0100-x", [run("q-a", 1, true), run("p-a", 1, true)], { manifest });
  const row = logRow(r, { baselineId: "b", regressed: ["q-b"], fixed: [], changed: [] });
  assert.equal(row, "| `20261014T0100-x` | router；router: gemini-2.5-flash-lite；commercial、supply_chain: gemini-2.5-flash | 100% | — | 1.0s | ✅ | `q-b` |  |");
});
