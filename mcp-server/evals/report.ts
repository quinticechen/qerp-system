/**
 * Eval report — the JSON a run writes to evals/reports/, its metrics, the thresholds (gates),
 * the comparison with a baseline run and the Markdown summary. Pure functions, so
 * tests/eval-report.test.ts covers them without calling any model. See docs/QUERY_AGENT_EVALS.md.
 *
 * Version 3 (2026-10-14) scores outcomes instead of tool paths
 * (docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md). Earlier reports are not comparable and are
 * never used as a baseline.
 */

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentMode } from "../src/agent/answer.js";
import { ROUTABLE_GROUPS } from "../src/agent/permissions.js";
import type { ModelCall, ObservedToolCall, RouteDecision } from "../src/agent/observer.js";
import type { Draft } from "../src/tools/types.js";
import { kindPassed, type CheckResult } from "./checks.js";
import type { JudgeVerdict } from "./judge.js";
import type { RecordedWrite } from "./fake-supabase.js";

// ── Results ───────────────────────────────────────────────────────────────────

export interface RunAttempt {
  phase: string;
  modelId: string;
  startedAt: number;
  durationMs: number;
  calls: ModelCall[];
  error?: string;
}

export interface RunStep {
  agent: string;
  /** Epoch ms when the step finished. */
  at: number;
  toolCalls: ObservedToolCall[];
}

export interface RunResult {
  caseId: string;
  run: number;
  pass: boolean;
  checks: CheckResult[];
  reply: string;
  error?: string;
  route?: RouteDecision;
  routeFromFallback: boolean;
  toolCalls: ObservedToolCall[];
  writes: RecordedWrite[];
  drafts: Draft[];
  modelErrors: string[];
  latencyMs: number;
  startedAt: number;
  attempts: RunAttempt[];
  steps: RunStep[];
  /** LLM judge on the reply policy (evals/judge.ts); recorded only. null = not judged or the judge failed. */
  judge?: JudgeVerdict | null;
}

// ── Report ────────────────────────────────────────────────────────────────────

/** The phases each architecture calls a model in. */
export const ARCH_PHASES: Record<AgentMode, string[]> = {
  router: ["router", ...ROUTABLE_GROUPS.map((group) => `agent:${group}`), "summary"],
  single: ["agent:all"],
};

/** What was run — two reports are a fair comparison when they differ in one of these only. */
export interface Manifest {
  arch: AgentMode;
  /** Model IDs per phase the architecture uses (primary first). */
  models: Record<string, readonly string[]>;
  /** Short hashes of the system prompts, tool definitions, cases and fixtures. */
  hashes: Record<string, string>;
  git?: { commit: string; dirty: boolean };
  /** Set when the run used Langfuse prompts (--prompt-label): the label and each prompt's version. */
  prompts?: { label: string; versions: Record<string, number> };
}

export interface CaseInfo {
  id: string;
  /** Langfuse dataset item id. */
  itemId: string;
  name: string;
  category: string;
  domain: string;
  /** The case expects a draft — counted in the write gate. */
  expectsDraft: boolean;
  /** Why the case is left out of metrics and gates (known gap, unreviewed); absent when it counts. */
  unscored?: string;
}

export interface Metrics {
  /** Fractions 0–1 over runs of scored cases; null when nothing to measure. */
  taskCompletion: number | null;
  /** 95% Wilson interval of taskCompletion, with the number of scored cases as the sample size. */
  taskCompletionCI: [number, number] | null;
  /** Runs (every case, scored or not) whose rule checks all passed. */
  rules: number | null;
  /** Scored runs with outcome checks whose outcome checks all passed. */
  outcome: number | null;
  /** Task completion of scored cases that expect a draft. */
  writeCompletion: number | null;
  /** Diagnostics: runs whose expected tools were all called; runs routed as expected (router only). */
  toolSelection: number | null;
  routing: number | null;
  /** Expected tool not called, and which unexpected tool was called instead — most frequent first. */
  toolConfusion: { expected: string; called: string; count: number }[];
  errorRate: number | null;
  fallbackRate: number | null;
  byCategory: Record<string, number>;
  byDomain: Record<string, number>;
  /** Average LLM-judge score (0–1) of scored runs, overall and per category; recorded only (not a gate). */
  policyJudge: number | null;
  policyJudgeByCategory: Record<string, number>;
  latencyMs: { avg: number; p50: number; p90: number; max: number };
  /** Per phase ("router", "agent:commercial", …): time spent in that phase per run. */
  phaseLatencyMs: Record<string, { p50: number; p90: number }>;
  /** US$, every provider call (router, sub-agents, failed attempts); null without cost data. */
  totalCostUsd: number | null;
  /** totalCostUsd ÷ passing runs — the cost of one completed task. */
  costPerCompletedTask: number | null;
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
}

export interface GateResult {
  id: string;
  label: string;
  value: number | null;
  /** Fractions (0–1) for most gates; milliseconds for latency. */
  unit: "ratio" | "ms";
  min?: number;
  max?: number;
  pass: boolean;
}

export interface EvalReport {
  version: 3;
  /** File name without extension, e.g. 20261014T0130-baseline. */
  id: string;
  label: string;
  createdAt: string;
  /** Set when only some cases ran; such a run is never used as a baseline. */
  filter?: string;
  runs: number;
  minPass: number;
  manifest: Manifest;
  /** The dataset the cases came from, and the snapshot (evals/snapshots/) holding them. */
  dataset: { name: string; version: string | null; snapshot: string };
  /** "skipped" (--skip-db-check): the fake data was not checked against the database; never a baseline. */
  dbCheck: "passed" | "skipped";
  cases: CaseInfo[];
  metrics: Metrics;
  gates: GateResult[];
  results: RunResult[];
  /** Set when the run was a Langfuse experiment: its link and each run's span ("<case id>#<run>"). */
  langfuse?: { experimentUrl?: string; runs: Record<string, LangfuseRunRef> };
}

/** Where one run lives in Langfuse; annotation queues and the judge calibration point at it. */
export interface LangfuseRunRef {
  traceId: string;
  observationId: string;
}

interface Gate {
  id: string;
  label: string;
  unit: GateResult["unit"];
  min?: number;
  max?: number;
  value: (m: Metrics) => number | null;
}

/** Report thresholds, set by the TPM (docs/QUERY_AGENT_EVALS.md §2). */
export const GATES: Gate[] = [
  { id: "overall", label: "整體任務完成率", unit: "ratio", min: 0.85, value: (m) => m.taskCompletion },
  { id: "rules", label: "不可違反的規則", unit: "ratio", min: 1, value: (m) => m.rules },
  { id: "permissions", label: "沒有權限類案例", unit: "ratio", min: 1, value: (m) => m.byCategory["沒有權限"] ?? null },
  { id: "write", label: "寫入類案例（應產生草稿）", unit: "ratio", min: 1, value: (m) => m.writeCompletion },
  { id: "latency", label: "平均延遲", unit: "ms", max: 10_000, value: (m) => (m.taskCompletion === null ? null : m.latencyMs.avg) },
];

function rate<T>(items: T[], pass: (item: T) => boolean): number | null {
  return items.length ? items.filter(pass).length / items.length : null;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** 95% Wilson score interval for a proportion p over n samples. */
export function wilson(p: number, n: number): [number, number] {
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** A run's model cost in US$ (all attempts), or null when no call reported a cost. */
export function costOf(r: RunResult): number | null {
  const costs = r.attempts.flatMap((a) => a.calls).map((c) => c.costUsd).filter((c): c is number => c !== null);
  return costs.length ? costs.reduce((a, b) => a + b, 0) : null;
}

function groupRate(runs: RunResult[], key: (r: RunResult) => string): Record<string, number> {
  const groups: Record<string, RunResult[]> = {};
  for (const r of runs) (groups[key(r)] ??= []).push(r);
  return Object.fromEntries(Object.entries(groups).sort().map(([k, rs]) => [k, rate(rs, (r) => r.pass)!]));
}

function toolConfusion(runs: RunResult[]): Metrics["toolConfusion"] {
  const counts = new Map<string, number>();
  for (const r of runs) {
    const expected = r.checks.filter((c) => c.kind === "diagnostic" && c.check.startsWith("calls ")).map((c) => c.check.slice(6));
    const missing = expected.filter((tool) => !r.toolCalls.some((t) => t.toolName === tool));
    const extra = [...new Set(r.toolCalls.map((t) => t.toolName))].filter((tool) => !expected.includes(tool));
    for (const want of missing) for (const got of extra.length ? extra : ["（沒有呼叫）"]) {
      const k = `${want}\u0000${got}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts].map(([k, count]) => { const [expected, called] = k.split("\u0000"); return { expected, called, count }; })
    .sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected));
}

function judgeMetrics(runs: RunResult[], category: (r: RunResult) => string): Pick<Metrics, "policyJudge" | "policyJudgeByCategory"> {
  const judged = runs.filter((r) => r.judge);
  const avg = (rs: RunResult[]) => rs.reduce((sum, r) => sum + r.judge!.score, 0) / rs.length;
  const groups: Record<string, RunResult[]> = {};
  for (const r of judged) (groups[category(r)] ??= []).push(r);
  return {
    policyJudge: judged.length ? avg(judged) : null,
    policyJudgeByCategory: Object.fromEntries(Object.entries(groups).sort().map(([k, rs]) => [k, avg(rs)])),
  };
}

export function computeMetrics(cases: CaseInfo[], results: RunResult[]): Metrics {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const scored = results.filter((r) => byId.has(r.caseId) && !byId.get(r.caseId)!.unscored);
  const withDiag = (prefix: string) => scored.filter((r) => r.checks.some((c) => c.kind === "diagnostic" && c.check.startsWith(prefix)));
  const diagPass = (prefix: string) => (r: RunResult) => r.checks.filter((c) => c.kind === "diagnostic" && c.check.startsWith(prefix)).every((c) => c.pass);

  const latencies = scored.map((r) => r.latencyMs);
  const phaseTimes: Record<string, number[]> = {};
  for (const r of scored) {
    const perRun: Record<string, number> = {};
    for (const a of r.attempts) perRun[a.phase] = (perRun[a.phase] ?? 0) + a.durationMs;
    for (const [phase, ms] of Object.entries(perRun)) (phaseTimes[phase] ??= []).push(ms);
  }

  const withCost = scored.map(costOf).filter((c): c is number => c !== null);
  const totalCostUsd = withCost.length ? withCost.reduce((a, b) => a + b, 0) : null;
  const passed = scored.filter((r) => r.pass).length;
  const calls = scored.map((r) => r.attempts.flatMap((a) => a.calls));
  const avgTokens = (pick: (c: ModelCall) => number) =>
    calls.length ? Math.round(calls.reduce((sum, cs) => sum + cs.reduce((s, c) => s + pick(c), 0), 0) / calls.length) : null;

  const taskCompletion = rate(scored, (r) => r.pass);
  const scoredCases = new Set(scored.map((r) => r.caseId)).size;

  return {
    taskCompletion,
    taskCompletionCI: taskCompletion === null ? null : wilson(taskCompletion, scoredCases),
    rules: rate(results, (r) => kindPassed(r.checks, "rule") !== false),
    outcome: rate(scored.filter((r) => kindPassed(r.checks, "outcome") !== null), (r) => kindPassed(r.checks, "outcome") === true),
    writeCompletion: rate(scored.filter((r) => byId.get(r.caseId)!.expectsDraft), (r) => r.pass),
    toolSelection: rate(withDiag("calls "), diagPass("calls ")),
    routing: rate(withDiag("routes to "), diagPass("routes to ")),
    toolConfusion: toolConfusion(scored),
    errorRate: rate(scored, (r) => !!r.error),
    fallbackRate: rate(scored, (r) => r.modelErrors.length > 0),
    byCategory: groupRate(scored, (r) => byId.get(r.caseId)!.category),
    ...judgeMetrics(scored, (r) => byId.get(r.caseId)!.category),
    byDomain: groupRate(scored, (r) => byId.get(r.caseId)!.domain),
    latencyMs: {
      avg: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      max: latencies.length ? Math.max(...latencies) : 0,
    },
    phaseLatencyMs: Object.fromEntries(
      Object.entries(phaseTimes).sort().map(([phase, ms]) => [phase, { p50: percentile(ms, 50), p90: percentile(ms, 90) }])
    ),
    totalCostUsd,
    costPerCompletedTask: totalCostUsd !== null && passed ? totalCostUsd / passed : null,
    avgInputTokens: avgTokens((c) => c.inputTokens),
    avgOutputTokens: avgTokens((c) => c.outputTokens),
  };
}

export function evaluateGates(metrics: Metrics): GateResult[] {
  return GATES.flatMap(({ id, label, unit, min, max, value }) => {
    const v = value(metrics);
    // A gate with nothing to measure (e.g. no case expects a draft) is left out.
    if (v === null) return [];
    const pass = (min === undefined || v >= min - 1e-9) && (max === undefined || v <= max);
    return [{ id, label, unit, value: v, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), pass }];
  });
}

/** ✅ passing, ❌ failing, 🚧 not scored (known gap, unreviewed). */
export type CaseStatus = "✅" | "❌" | "🚧";

export function caseStatuses(report: Pick<EvalReport, "cases" | "results" | "minPass">): Map<string, CaseStatus> {
  const statuses = new Map<string, CaseStatus>();
  for (const c of report.cases) {
    const runs = report.results.filter((r) => r.caseId === c.id);
    if (!runs.length) continue;
    const passRate = runs.filter((r) => r.pass).length / runs.length;
    statuses.set(c.id, c.unscored ? "🚧" : passRate >= report.minPass ? "✅" : "❌");
  }
  return statuses;
}

/** Cases whose status differs from the baseline; "regressed" is the no-regression bar in CLAUDE.md. */
export interface Comparison {
  baselineId: string;
  regressed: string[];
  fixed: string[];
  /** Manifest entries that differ: what changed between the two runs. */
  changed: string[];
}

function manifestEntries(m: Manifest): Record<string, string> {
  const entries: Record<string, string> = { arch: m.arch };
  for (const [phase, ids] of Object.entries(m.models)) entries[`models.${phase}`] = ids.join(", ");
  for (const [name, hash] of Object.entries(m.hashes)) entries[`hash.${name}`] = hash;
  if (m.git) entries.git = `${m.git.commit}${m.git.dirty ? "+dirty" : ""}`;
  entries["prompts.source"] = m.prompts ? m.prompts.label : "code";
  for (const [name, v] of Object.entries(m.prompts?.versions ?? {})) entries[`prompts.${name}`] = `v${v}`;
  return entries;
}

export function compareReports(baseline: EvalReport, current: EvalReport): Comparison {
  const before = caseStatuses(baseline);
  const after = caseStatuses(current);
  const regressed: string[] = [];
  const fixed: string[] = [];
  for (const [id, status] of after) {
    if (before.get(id) === "✅" && status === "❌") regressed.push(id);
    if (before.get(id) === "❌" && status === "✅") fixed.push(id);
  }
  const a = manifestEntries(baseline.manifest);
  const b = manifestEntries(current.manifest);
  const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => a[k] !== b[k] && !(k.startsWith("hash.") && (!a[k] || !b[k])))
    .map((k) => `${k}: ${a[k] ?? "—"} → ${b[k] ?? "—"}`);
  return { baselineId: baseline.id, regressed, fixed, changed };
}

// ── Loading ───────────────────────────────────────────────────────────────────

/** A version 3 report, or null for an earlier format (not comparable with outcome scoring). */
export function loadReport(path: string): EvalReport | null {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { version?: number };
  return raw.version === 3 ? (raw as EvalReport) : null;
}

/** Same architecture and the same primary model in every phase. */
function sameSetup(a: Manifest, b: Manifest): boolean {
  const primary = (m: Manifest, phase: string) => (m.models[phase] ?? m.models.default)?.[0];
  const phases = new Set([...Object.keys(a.models), ...Object.keys(b.models)].filter((p) => p !== "default"));
  return a.arch === b.arch && [...phases].every((p) => primary(a, p) === primary(b, p));
}

/**
 * The run to compare against: the most recent full, database-checked run with the same setup as
 * `current`, or else the most recent such run — so a model change is compared like for like.
 */
export function findBaseline(reportsDir: string, current: Pick<EvalReport, "id" | "manifest">): EvalReport | null {
  const full = readdirSync(reportsDir).filter((f) => f.endsWith(".json")).sort().reverse()
    .filter((f) => basename(f, ".json") !== current.id)
    .map((f) => loadReport(join(reportsDir, f)))
    .filter((r): r is EvalReport => !!r && !r.filter && r.dbCheck === "passed");
  return full.find((r) => sameSetup(r.manifest, current.manifest)) ?? full[0] ?? null;
}

// ── Markdown ──────────────────────────────────────────────────────────────────

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const usd = (v: number | null) => (v === null ? "—" : `US$${v.toFixed(5)}`);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function gateValue(g: Pick<GateResult, "unit" | "value">): string {
  return g.unit === "ms" ? secs(g.value ?? 0) : pct(g.value);
}

export function gateRequirement(g: Pick<GateResult, "unit" | "min" | "max">): string {
  const fmt = (v: number) => (g.unit === "ms" ? secs(v) : pct(v));
  return g.min !== undefined ? `≥ ${fmt(g.min)}` : `≤ ${fmt(g.max!)}`;
}

export function buildMarkdown(report: EvalReport, comparison: Comparison | null): string {
  const { metrics: m, manifest } = report;
  const statuses = caseStatuses(report);
  const ci = m.taskCompletionCI ? `（95% 信賴區間 ${pct(m.taskCompletionCI[0])}–${pct(m.taskCompletionCI[1])}）` : "";
  const lines: string[] = [
    `# Query Agent Eval — ${report.label}`,
    "",
    `- 報告：\`${report.id}\`（${report.createdAt}）`,
    `- 案例：${report.cases.length}（每案 ${report.runs} 次）；案例通過門檻 ${Math.round(report.minPass * 100)}%${report.filter ? `；篩選 \`${report.filter}\`` : ""}`,
    `- Dataset：\`${report.dataset.name}\`${report.dataset.version ? ` 版本 ${report.dataset.version}` : "（最新）"}；快照 \`${report.dataset.snapshot}\``,
    `- 資料庫一致性檢查：${report.dbCheck === "passed" ? "通過" : "略過（不會被當成基準）"}`,
    `- Prompt：${manifest.prompts ? `Langfuse 標籤 \`${manifest.prompts.label}\`（${Object.entries(manifest.prompts.versions).map(([n, v]) => `${n} v${v}`).join("、")}）` : "程式內建"}`,
    `- 架構：${manifest.arch}；git ${manifest.git ? `${manifest.git.commit}${manifest.git.dirty ? "（有未提交的修改）" : ""}` : "—"}`,
    "",
    "| 節點 | 模型（主 → 降級） |",
    "|------|------------------|",
    ...Object.entries(manifest.models).map(([phase, ids]) => `| ${phase} | ${ids.join(" → ")} |`),
    "",
    "## 門檻",
    "",
    "| 門檻 | 數值 | 要求 | 結果 |",
    "|------|------|------|------|",
    ...report.gates.map((g) => `| ${g.label} | ${gateValue(g)} | ${gateRequirement(g)} | ${g.pass ? "✅" : "❌"} |`),
    "",
    "## 指標（不含 🚧 案例；規則含全部案例）",
    "",
    "| 指標 | 數值 |",
    "|------|------|",
    `| 任務完成率 | ${pct(m.taskCompletion)}${ci} |`,
    `| 規則全部通過 | ${pct(m.rules)} |`,
    `| 任務結果正確 | ${pct(m.outcome)} |`,
    `| 寫入類完成率 | ${pct(m.writeCompletion)} |`,
    `| 回覆品質（LLM 評分，僅記錄） | ${pct(m.policyJudge)} |`,
    `| 錯誤率 | ${pct(m.errorRate)} |`,
    `| 降級率 | ${pct(m.fallbackRate)} |`,
    `| 每個完成任務的花費 | ${usd(m.costPerCompletedTask)} |`,
    `| 總花費 | ${usd(m.totalCostUsd)} |`,
    `| 延遲 平均／P50／P90／最大 | ${secs(m.latencyMs.avg)}／${secs(m.latencyMs.p50)}／${secs(m.latencyMs.p90)}／${secs(m.latencyMs.max)} |`,
    ...Object.entries(m.phaseLatencyMs).map(([phase, l]) => `| ${phase} 延遲 P50／P90 | ${secs(l.p50)}／${secs(l.p90)} |`),
    `| 平均 token（輸入／輸出，含 Router） | ${m.avgInputTokens ?? "—"}／${m.avgOutputTokens ?? "—"} |`,
    ...Object.entries(m.byCategory).map(([category, v]) => `| 類別 ${category} | ${pct(v)} |`),
    ...Object.entries(m.byDomain).map(([domain, v]) => `| 領域 ${domain} | ${pct(v)} |`),
    "",
    "## 診斷（不影響是否通過）",
    "",
    `- Tool 選擇正確率：${pct(m.toolSelection)}；Router 分派正確率：${pct(m.routing)}`,
    `- 回覆品質（LLM 評分，校準前不計入門檻）：${Object.entries(m.policyJudgeByCategory).map(([k, v]) => `${k} ${pct(v)}`).join("、") || "—"}`,
    "",
  ];
  if (m.toolConfusion.length) {
    lines.push("| 應呼叫 | 實際呼叫 | 次數 |", "|--------|----------|------|", ...m.toolConfusion.slice(0, 15).map((t) => `| ${t.expected} | ${t.called} | ${t.count} |`), "");
  }

  if (comparison) {
    lines.push(
      `## 與基準比較（\`${comparison.baselineId}\`）`,
      "",
      `- 退步（✅ → ❌）：${comparison.regressed.length ? comparison.regressed.map((id) => `\`${id}\``).join("、") : "無"}`,
      `- 修好（❌ → ✅）：${comparison.fixed.length ? comparison.fixed.map((id) => `\`${id}\``).join("、") : "無"}`,
      `- 設定差異：${comparison.changed.length ? "" : "無"}`,
      ...comparison.changed.map((c) => `  - ${c}`),
      ""
    );
  }

  lines.push("## 各案例", "", "| 案例 | 類別 | 領域 | 通過 | 路由 | 呼叫的 tools |", "|------|------|------|------|------|--------------|");
  for (const c of report.cases) {
    const rs = report.results.filter((r) => r.caseId === c.id);
    const routes = [...new Set(rs.map((r) => (r.route?.agents.join("+") ?? "—") + (r.routeFromFallback ? "(fallback)" : "")))].join(" / ");
    const tools = [...new Set(rs.flatMap((r) => r.toolCalls.map((t) => t.toolName)))].join(", ") || "—";
    lines.push(`| ${statuses.get(c.id) ?? "—"} \`${c.id}\` ${c.name} | ${c.category} | ${c.domain} | ${rs.filter((r) => r.pass).length}/${rs.length} | ${routes} | ${tools} |`);
  }

  lines.push("", "## 失敗明細", "");
  for (const c of report.cases) {
    const failedRuns = report.results.filter((r) => r.caseId === c.id && !r.pass);
    if (!failedRuns.length) continue;
    lines.push(`### \`${c.id}\` ${c.name}${c.unscored ? `（不計分：${c.unscored}）` : ""}`, "");
    for (const r of failedRuns) {
      const failed = r.checks.filter((ch) => ch.kind !== "diagnostic" && !ch.pass).map((ch) => `${ch.check}${ch.detail ? `（${ch.detail}）` : ""}`);
      const diag = r.checks.filter((ch) => ch.kind === "diagnostic" && !ch.pass).map((ch) => `${ch.check}${ch.detail ? `（${ch.detail}）` : ""}`);
      lines.push(`- run ${r.run}：${failed.join("；")}`);
      if (diag.length) lines.push(`  - 診斷：${diag.join("；")}`);
      if (r.modelErrors.length) lines.push(`  - 模型錯誤：${r.modelErrors.join("；")}`);
      if (r.judge) lines.push(`  - LLM 評分 ${pct(r.judge.score)}：${r.judge.reason}`);
      lines.push(`  - 回覆：${r.reply.replace(/\s+/g, " ").slice(0, 200) || "（無）"}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** "router: gemini-2.5-flash-lite；commercial、supply_chain: gemini-2.5-flash" — primary model per phase. */
export function modelSummary(manifest: Manifest): string {
  const byModel = new Map<string, string[]>();
  for (const [phase, ids] of Object.entries(manifest.models)) {
    const model = ids[0]?.split("/").pop() ?? "—";
    byModel.set(model, [...(byModel.get(model) ?? []), phase.replace(/^agent:/, "")]);
  }
  return [...byModel].map(([model, phases]) => `${phases.join("、")}: ${model}`).join("；");
}

/** One row of the experiment log (docs/QUERY_AGENT_EVALS.md §5); the TPM fills in the decision. */
export function logRow(report: EvalReport, comparison: Comparison | null): string {
  const m = report.metrics;
  const gates = report.gates.every((g) => g.pass) ? "✅" : `❌ ${report.gates.filter((g) => !g.pass).map((g) => g.label).join("、")}`;
  const regressed = comparison ? (comparison.regressed.length ? comparison.regressed.map((id) => `\`${id}\``).join("、") : "無") : "—";
  return `| \`${report.id}\` | ${report.manifest.arch}；${modelSummary(report.manifest)} | ${pct(m.taskCompletion)} | ${usd(m.costPerCompletedTask)} | ${secs(m.latencyMs.p90)} | ${gates} | ${regressed} |  |`;
}
