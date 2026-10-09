/**
 * Eval report — the JSON a run writes to evals/reports/, its metrics, the thresholds (gates),
 * the comparison with a baseline run and the Markdown summary. Pure functions, so
 * tests/eval-report.test.ts covers them without calling any model. See docs/QUERY_AGENT_EVALS.md.
 */

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentMode } from "../src/agent/answer.js";
import type { ModelCall, ObservedToolCall, RouteDecision } from "../src/agent/observer.js";
import type { Draft } from "../src/tools/types.js";
import type { RecordedWrite } from "./fake-supabase.js";

// ── Cases ─────────────────────────────────────────────────────────────────────

export interface EvalExpect {
  tools_include?: string[];
  tools_exclude?: string[];
  tool_args?: { tool: string; args: Record<string, unknown> }[];
  agents_include?: string[];
  /** Drafts (pending writes) per tool, exact. The agent loop itself never writes business data. */
  drafts?: Record<string, number>;
  no_drafts?: boolean;
  no_writes?: boolean;
  reply_matches?: string[];
  reply_not_matches?: string[];
}

export interface EvalCase {
  id: string;
  name: string;
  /** The case file's name: query, write, permissions, regressions, paraphrase. */
  category: string;
  note?: string;
  known_gap?: string;
  fixtures?: string;
  role?: string;
  /** May carry metadata.entities, as replies saved by the server do. */
  history?: { role: string; content: string; metadata?: unknown }[];
  message: string;
  expect: EvalExpect;
}

/** Every case in evals/cases/, with its category taken from the file name. */
export function loadCases(casesDir: string, filter?: string): EvalCase[] {
  const cases = readdirSync(casesDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => (JSON.parse(readFileSync(join(casesDir, f), "utf8")) as Omit<EvalCase, "category">[])
      .map((c) => ({ ...c, category: basename(f, ".json") })));
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`Duplicate eval case id: ${c.id}`);
    ids.add(c.id);
  }
  return filter ? cases.filter((c) => c.id.includes(filter)) : cases;
}

// ── Results ───────────────────────────────────────────────────────────────────

export interface CheckResult {
  check: string;
  pass: boolean;
  detail?: string;
}

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
  /** Sub-agent tokens only (kept for reports written before attempts were recorded). */
  tokens: number;
  latencyMs: number;
  /** Absent in reports written before 2026-10-09. */
  startedAt?: number;
  attempts?: RunAttempt[];
  steps?: RunStep[];
}

// ── Report ────────────────────────────────────────────────────────────────────

/** The phases each architecture calls a model in. */
export const ARCH_PHASES: Record<AgentMode, string[]> = {
  router: ["router", "agent:commercial", "agent:supply_chain"],
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
}

export interface CaseInfo {
  id: string;
  name: string;
  category: string;
  known_gap?: string;
}

export interface Metrics {
  /** Fractions 0–1 over runs of cases without known_gap; null when nothing to measure. */
  taskCompletion: number | null;
  toolSelection: number | null;
  /** Share of runs passing their "routes to" checks — router architecture only. */
  routing: number | null;
  errorRate: number | null;
  fallbackRate: number | null;
  byCategory: Record<string, number>;
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
  min: number;
  value: number | null;
  pass: boolean;
}

export interface EvalReport {
  version: 2;
  /** File name without extension, e.g. 20261009T0130-baseline. */
  id: string;
  label: string;
  createdAt: string;
  /** Set when only some cases ran; such a run is never used as a baseline. */
  filter?: string;
  runs: number;
  minPass: number;
  manifest: Manifest;
  cases: CaseInfo[];
  metrics: Metrics;
  gates: GateResult[];
  results: RunResult[];
}

/** Report thresholds, set by the TPM (docs/QUERY_AGENT_EVALS.md §2). */
export const GATES: { id: string; label: string; min: number; value: (m: Metrics) => number | null }[] = [
  { id: "overall", label: "整體任務完成率", min: 0.85, value: (m) => m.taskCompletion },
  { id: "routing", label: "Router 分派正確率", min: 0.95, value: (m) => m.routing },
  { id: "permissions", label: "權限類案例", min: 1, value: (m) => m.byCategory.permissions ?? null },
  { id: "write", label: "寫入類案例", min: 1, value: (m) => m.byCategory.write ?? null },
];

const TOOL_CHECK_RE = /^(calls |does not call |\S+ args ⊇ )/;
const ROUTE_CHECK_RE = /^routes to /;

function rate(runs: RunResult[], pass: (r: RunResult) => boolean): number | null {
  return runs.length ? runs.filter(pass).length / runs.length : null;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function costOf(r: RunResult): number | null {
  const calls = (r.attempts ?? []).flatMap((a) => a.calls);
  const costs = calls.map((c) => c.costUsd).filter((c): c is number => c !== null);
  return costs.length ? costs.reduce((a, b) => a + b, 0) : null;
}

export function computeMetrics(cases: CaseInfo[], results: RunResult[]): Metrics {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const gated = results.filter((r) => !byId.get(r.caseId)?.known_gap);
  const checksPass = (re: RegExp) => (r: RunResult) => r.checks.filter((c) => re.test(c.check)).every((c) => c.pass);
  const having = (re: RegExp) => gated.filter((r) => r.checks.some((c) => re.test(c.check)));

  const byCategory: Record<string, number> = {};
  for (const category of new Set(gated.map((r) => byId.get(r.caseId)?.category ?? "unknown"))) {
    byCategory[category] = rate(gated.filter((r) => (byId.get(r.caseId)?.category ?? "unknown") === category), (r) => r.pass)!;
  }

  const latencies = gated.map((r) => r.latencyMs);
  const phaseTimes: Record<string, number[]> = {};
  for (const r of gated) {
    const perRun: Record<string, number> = {};
    for (const a of r.attempts ?? []) perRun[a.phase] = (perRun[a.phase] ?? 0) + a.durationMs;
    for (const [phase, ms] of Object.entries(perRun)) (phaseTimes[phase] ??= []).push(ms);
  }

  const costs = gated.map(costOf);
  const withCost = costs.filter((c): c is number => c !== null);
  const totalCostUsd = withCost.length ? withCost.reduce((a, b) => a + b, 0) : null;
  const passed = gated.filter((r) => r.pass).length;
  const calls = gated.filter((r) => r.attempts).map((r) => r.attempts!.flatMap((a) => a.calls));
  const avgTokens = (pick: (c: ModelCall) => number) =>
    calls.length ? Math.round(calls.reduce((sum, cs) => sum + cs.reduce((s, c) => s + pick(c), 0), 0) / calls.length) : null;

  return {
    taskCompletion: rate(gated, (r) => r.pass),
    toolSelection: rate(having(TOOL_CHECK_RE), checksPass(TOOL_CHECK_RE)),
    routing: rate(having(ROUTE_CHECK_RE), checksPass(ROUTE_CHECK_RE)),
    errorRate: rate(gated, (r) => !!r.error),
    fallbackRate: rate(gated, (r) => r.modelErrors.length > 0),
    byCategory,
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
  return GATES.flatMap(({ id, label, min, value }) => {
    const v = value(metrics);
    // A gate with nothing to measure (e.g. routing for the single agent) is left out.
    return v === null ? [] : [{ id, label, min, value: v, pass: v >= min - 1e-9 }];
  });
}

/** ✅ passing, ❌ failing, 🚧 known gap (not scored). */
export type CaseStatus = "✅" | "❌" | "🚧";

export function caseStatuses(report: Pick<EvalReport, "cases" | "results" | "minPass">): Map<string, CaseStatus> {
  const statuses = new Map<string, CaseStatus>();
  for (const c of report.cases) {
    const runs = report.results.filter((r) => r.caseId === c.id);
    if (!runs.length) continue;
    const passRate = runs.filter((r) => r.pass).length / runs.length;
    statuses.set(c.id, c.known_gap ? "🚧" : passRate >= report.minPass ? "✅" : "❌");
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

/** Report as written before 2026-10-09: no manifest, cases, gates or attempts; one primary model for every phase. */
interface LegacyReport {
  label: string;
  /** Recorded from P0-7 on; every run before it was router × gemini-2.5-flash-lite. */
  arch?: AgentMode;
  primary?: string;
  results: RunResult[];
}

/** "20261007T0443-baseline-router" → 2026-10-07T04:43:00Z (the runner names files in UTC). */
function stampToIso(id: string): string {
  const m = id.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00.000Z` : new Date(0).toISOString();
}

/** Reads a report; older reports are upgraded using the current case files for names and categories. */
/**
 * Known gaps that pre-v2 reports were scored with but the current case files no longer carry
 * (the gap was closed later). Legacy reports do not store their gaps, so without this an old
 * run would be re-scored as failing a case it was never expected to pass.
 */
const LEGACY_KNOWN_GAPS: Record<string, string> = {
  "w-cross-domain-order": "create_order 無法帶入品項與工廠，需 Phase 1 訂單主流程的 tools",
};

export function loadReport(path: string, currentCases: EvalCase[]): EvalReport {
  const raw = JSON.parse(readFileSync(path, "utf8")) as EvalReport | LegacyReport;
  if ("version" in raw && raw.version === 2) return raw;

  const legacy = raw as LegacyReport;
  const id = basename(path, ".json");
  const arch = legacy.arch ?? "router";
  const primary = legacy.primary ?? "google/gemini-2.5-flash-lite";
  const known = new Map(currentCases.map((c) => [c.id, c]));
  const cases: CaseInfo[] = [...new Set(legacy.results.map((r) => r.caseId))].map((caseId) => {
    const c = known.get(caseId);
    const knownGap = c?.known_gap ?? LEGACY_KNOWN_GAPS[caseId];
    return { id: caseId, name: c?.name ?? caseId, category: c?.category ?? "unknown", ...(knownGap ? { known_gap: knownGap } : {}) };
  });
  const runs = Math.max(...legacy.results.map((r) => r.run));
  const metrics = computeMetrics(cases, legacy.results);
  return {
    version: 2,
    id,
    label: legacy.label,
    createdAt: stampToIso(id),
    runs,
    minPass: 0.66,
    manifest: { arch, models: Object.fromEntries(ARCH_PHASES[arch].map((p) => [p, [primary]])), hashes: {} },
    cases,
    metrics,
    gates: evaluateGates(metrics),
    results: legacy.results,
  };
}

/** Same architecture and the same primary model in every phase (older reports record only the primary). */
function sameSetup(a: Manifest, b: Manifest): boolean {
  const primary = (m: Manifest, phase: string) => (m.models[phase] ?? m.models.default)?.[0];
  const phases = new Set([...Object.keys(a.models), ...Object.keys(b.models)].filter((p) => p !== "default"));
  return a.arch === b.arch && [...phases].every((p) => primary(a, p) === primary(b, p));
}

/**
 * The run to compare against: the most recent run of all cases with the same setup as `current`,
 * or else the most recent run of all cases — so a model change is compared like for like.
 */
export function findBaseline(reportsDir: string, currentCases: EvalCase[], current: Pick<EvalReport, "id" | "manifest">): EvalReport | null {
  const full = readdirSync(reportsDir).filter((f) => f.endsWith(".json")).sort().reverse()
    .filter((f) => basename(f, ".json") !== current.id)
    .map((f) => loadReport(join(reportsDir, f), currentCases))
    .filter((r) => !r.filter);
  return full.find((r) => sameSetup(r.manifest, current.manifest)) ?? full[0] ?? null;
}

// ── Markdown ──────────────────────────────────────────────────────────────────

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const usd = (v: number | null) => (v === null ? "—" : `US$${v.toFixed(5)}`);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function buildMarkdown(report: EvalReport, comparison: Comparison | null): string {
  const { metrics: m, manifest } = report;
  const statuses = caseStatuses(report);
  const lines: string[] = [
    `# Query Agent Eval — ${report.label}`,
    "",
    `- 報告：\`${report.id}\`（${report.createdAt}）`,
    `- 案例：${report.cases.length}（每案 ${report.runs} 次）；案例通過門檻 ${Math.round(report.minPass * 100)}%${report.filter ? `；篩選 \`${report.filter}\`` : ""}`,
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
    ...report.gates.map((g) => `| ${g.label} | ${pct(g.value)} | ≥ ${pct(g.min)} | ${g.pass ? "✅" : "❌"} |`),
    "",
    "## 指標（不含 known_gap 案例）",
    "",
    "| 指標 | 數值 |",
    "|------|------|",
    `| 任務完成率 | ${pct(m.taskCompletion)} |`,
    `| Tool 選擇正確率 | ${pct(m.toolSelection)} |`,
    `| Router 分派正確率 | ${pct(m.routing)} |`,
    `| 錯誤率 | ${pct(m.errorRate)} |`,
    `| 降級率 | ${pct(m.fallbackRate)} |`,
    `| 每個完成任務的花費 | ${usd(m.costPerCompletedTask)} |`,
    `| 總花費 | ${usd(m.totalCostUsd)} |`,
    `| 延遲 平均／P50／P90／最大 | ${secs(m.latencyMs.avg)}／${secs(m.latencyMs.p50)}／${secs(m.latencyMs.p90)}／${secs(m.latencyMs.max)} |`,
    ...Object.entries(m.phaseLatencyMs).map(([phase, l]) => `| ${phase} 延遲 P50／P90 | ${secs(l.p50)}／${secs(l.p90)} |`),
    `| 平均 token（輸入／輸出，含 Router） | ${m.avgInputTokens ?? "—"}／${m.avgOutputTokens ?? "—"} |`,
    ...Object.entries(m.byCategory).map(([category, v]) => `| 類別 ${category} | ${pct(v)} |`),
    "",
  ];

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

  lines.push("## 各案例", "", "| 案例 | 通過 | 路由 | 呼叫的 tools |", "|------|------|------|--------------|");
  for (const c of report.cases) {
    const rs = report.results.filter((r) => r.caseId === c.id);
    const routes = [...new Set(rs.map((r) => (r.route?.agents.join("+") ?? "—") + (r.routeFromFallback ? "(fallback)" : "")))].join(" / ");
    const tools = [...new Set(rs.flatMap((r) => r.toolCalls.map((t) => t.toolName)))].join(", ") || "—";
    lines.push(`| ${statuses.get(c.id) ?? "—"} \`${c.id}\` ${c.name} | ${rs.filter((r) => r.pass).length}/${rs.length} | ${routes} | ${tools} |`);
  }

  lines.push("", "## 失敗明細", "");
  for (const c of report.cases) {
    const failedRuns = report.results.filter((r) => r.caseId === c.id && !r.pass);
    if (!failedRuns.length) continue;
    lines.push(`### \`${c.id}\` ${c.name}${c.known_gap ? `（known gap：${c.known_gap}）` : ""}`, "");
    for (const r of failedRuns) {
      const failed = r.checks.filter((ch) => !ch.pass).map((ch) => `${ch.check}${ch.detail ? `（${ch.detail}）` : ""}`);
      lines.push(`- run ${r.run}：${failed.join("；")}`);
      if (r.modelErrors.length) lines.push(`  - 模型錯誤：${r.modelErrors.join("；")}`);
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
