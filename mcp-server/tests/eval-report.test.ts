/**
 * Eval report metrics, gates, baseline comparison and the Langfuse payload — no models, no network.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareReports, computeMetrics, evaluateGates, findBaseline, loadCases, loadReport, logRow, modelSummary, percentile,
  type CaseInfo, type EvalReport, type RunResult,
} from "../evals/report.js";
import { buildCaseSpans, buildScores, hexId } from "../evals/langfuse.js";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "evals");

const CASES: CaseInfo[] = [
  { id: "q-a", name: "查詢 A", category: "query" },
  { id: "p-a", name: "權限 A", category: "permissions" },
  { id: "w-gap", name: "已知限制", category: "write", known_gap: "Phase 1" },
];

function run(caseId: string, n: number, pass: boolean, extra: Partial<RunResult> = {}): RunResult {
  return {
    caseId, run: n, pass, reply: `回覆 ${caseId} ${n}`, routeFromFallback: false, toolCalls: [], writes: [], drafts: [],
    modelErrors: [], tokens: 0, latencyMs: 1000 * n,
    checks: [{ check: "no_error", pass: true }, { check: "routes to commercial", pass }],
    ...extra,
  };
}

const call = (costUsd: number | null) => ({ startedAt: 0, durationMs: 100, inputTokens: 100, outputTokens: 10, costUsd });

function report(id: string, results: RunResult[], overrides: Partial<EvalReport> = {}): EvalReport {
  const metrics = computeMetrics(CASES, results);
  return {
    version: 2, id, label: id, createdAt: "2026-10-09T00:00:00.000Z", runs: 3, minPass: 0.66,
    manifest: { arch: "router", models: { router: ["lite"], "agent:commercial": ["lite"] }, hashes: { "prompt.router": "aaaa1111" } },
    cases: CASES, metrics, gates: evaluateGates(metrics), results, ...overrides,
  };
}

test("cost per completed task divides every call's cost, failed runs included, by the passing runs", () => {
  const attempt = (costs: (number | null)[]) => [{ phase: "router", modelId: "lite", startedAt: 0, durationMs: 300, calls: costs.map(call) }];
  const results = [
    run("q-a", 1, true, { attempts: attempt([0.001, 0.002]) }),
    run("q-a", 2, false, { attempts: attempt([0.003]) }),
    run("p-a", 1, true, { attempts: attempt([null]) }),
    run("w-gap", 1, false, { attempts: attempt([1]) }), // known gap: not counted
  ];
  const m = computeMetrics(CASES, results);
  assert.ok(Math.abs(m.totalCostUsd! - 0.006) < 1e-12);
  assert.ok(Math.abs(m.costPerCompletedTask! - 0.003) < 1e-12);
  assert.equal(m.taskCompletion, 2 / 3);
  assert.deepEqual(m.byCategory, { query: 0.5, permissions: 1 });
  assert.deepEqual(m.phaseLatencyMs.router, { p50: 300, p90: 300 });
  assert.equal(m.avgInputTokens, 133);
});

test("without cost data the cost metrics are empty, not zero", () => {
  const m = computeMetrics(CASES, [run("q-a", 1, true)]);
  assert.equal(m.totalCostUsd, null);
  assert.equal(m.costPerCompletedTask, null);
});

test("gates: permissions must be 100%; a gate with nothing to measure is left out", () => {
  const gates = evaluateGates(computeMetrics(CASES, [run("q-a", 1, true), run("p-a", 1, true), run("p-a", 2, false)]));
  assert.deepEqual(gates.map((g) => [g.id, g.pass]), [["overall", false], ["routing", false], ["permissions", false]]);
  const single = evaluateGates(computeMetrics(CASES, [{ ...run("q-a", 1, true), checks: [{ check: "no_error", pass: true }] }]));
  assert.ok(!single.some((g) => g.id === "routing"), "no routing checks, no routing gate");
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
  assert.deepEqual(c.fixed, ["p-a"], "known gaps are neither");
  assert.deepEqual(c.changed, ["models.agent:commercial: lite → flash, lite"]);
});

test("the baseline is the latest full run with the same setup, else the latest full run", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-reports-"));
  const lite = { arch: "router" as const, models: { router: ["lite"], "agent:commercial": ["lite"] }, hashes: {} };
  const flash = { ...lite, models: { router: ["lite"], "agent:commercial": ["flash"] } };
  const save = (r: EvalReport) => writeFileSync(join(dir, `${r.id}.json`), JSON.stringify(r));
  save(report("20261001T0000-lite", [run("q-a", 1, true)], { manifest: lite }));
  save(report("20261002T0000-flash", [run("q-a", 1, true)], { manifest: flash }));
  save(report("20261003T0000-lite-filtered", [run("q-a", 1, true)], { manifest: lite, filter: "q-" }));

  assert.equal(findBaseline(dir, [], { id: "now", manifest: lite })?.id, "20261001T0000-lite");
  assert.equal(findBaseline(dir, [], { id: "now", manifest: { ...lite, arch: "single", models: { "agent:all": ["x"] } } })?.id, "20261002T0000-flash");
});

test("reports written before 2026-10-09 load with categories from the current case files", () => {
  const cases = loadCases(join(EVALS_DIR, "cases"));
  const legacy = loadReport(join(EVALS_DIR, "reports", "20261007T0757-p0-7-router-lite.json"), cases);
  assert.equal(legacy.version, 2);
  assert.equal(legacy.createdAt, "2026-10-07T07:57:00.000Z");
  assert.deepEqual(legacy.manifest.models.router, ["google/gemini-2.5-flash-lite"]);
  assert.equal(legacy.cases.find((c) => c.id === "p-sales-cannot-create-po")?.category, "permissions");
  assert.equal(Math.round(legacy.metrics.taskCompletion! * 100), 86, "same accuracy as the original report");
  assert.equal(legacy.metrics.totalCostUsd, null);
});

test("Langfuse spans: one trace per case with experiment attributes, deterministic IDs", () => {
  const results = [
    run("q-a", 1, true, {
      startedAt: 1_000_000,
      attempts: [{ phase: "agent:commercial", modelId: "lite", startedAt: 1_000_100, durationMs: 500, calls: [call(0.0001)] }],
      steps: [{ agent: "commercial", at: 1_000_400, toolCalls: [{ toolName: "list_customers", args: { search: "Chen" } }] }],
    }),
  ];
  const r = report("20261009T0100-test", results);
  const spans = buildCaseSpans(r, CASES[0], undefined, "dataset-1");
  const traceId = hexId("20261009T0100-test:q-a", 32);
  assert.ok(spans.every((s) => s.traceId === traceId));
  const attr = (name: string, key: string) =>
    spans.find((s) => s.name === name)?.attributes.find((a) => a.key === key)?.value;

  const root = spans.find((s) => !s.parentSpanId)!;
  assert.equal(root.name, "eval:q-a");
  assert.deepEqual(attr("eval:q-a", "langfuse.experiment.id"), { stringValue: "20261009T0100-test" });
  assert.deepEqual(attr("eval:q-a", "langfuse.experiment.item.root_observation_id"), { stringValue: root.spanId });
  assert.deepEqual(attr("agent:commercial · lite", "langfuse.observation.type"), { stringValue: "generation" });
  assert.deepEqual(attr("agent:commercial · lite", "langfuse.observation.cost_details"), { stringValue: '{"total":0.0001}' });
  assert.deepEqual(attr("list_customers", "langfuse.observation.type"), { stringValue: "tool" });
  assert.equal(spans.find((s) => s.name === "run 1")!.startTimeUnixNano, "1000000000000");

  assert.deepEqual(buildCaseSpans(r, CASES[0], undefined, "dataset-1"), spans, "same report → same spans");
});

test("Langfuse scores: pass_rate for every case, passed only for scored cases", () => {
  const r = report("x", [run("q-a", 1, true), run("q-a", 2, false), run("w-gap", 1, false)]);
  const scores = buildScores(r) as { name: string; value: number; traceId: string; comment?: string }[];
  assert.deepEqual(scores.map((s) => [s.name, s.value]), [["pass_rate", 0.5], ["passed", 0], ["pass_rate", 0]]);
  assert.match(scores[0].comment!, /run 2：routes to commercial/);
});

test("experiment log row: primary model per phase, gates, regressions and an empty decision cell", () => {
  const manifest = {
    arch: "router" as const, hashes: {},
    models: { router: ["google/gemini-2.5-flash-lite"], "agent:commercial": ["google/gemini-2.5-flash", "x"], "agent:supply_chain": ["google/gemini-2.5-flash"] },
  };
  assert.equal(modelSummary(manifest), "router: gemini-2.5-flash-lite；commercial、supply_chain: gemini-2.5-flash");
  const r = report("20261009T0100-x", [run("q-a", 1, true), run("p-a", 1, true)], { manifest });
  const row = logRow(r, { baselineId: "b", regressed: ["q-b"], fixed: [], changed: [] });
  assert.equal(row, "| `20261009T0100-x` | router；router: gemini-2.5-flash-lite；commercial、supply_chain: gemini-2.5-flash | 100% | — | 1.0s | ✅ | `q-b` |  |");
});
