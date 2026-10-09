/**
 * Query Agent eval runner — replays cases against the real agent pipeline and real models,
 * with an in-memory fake database (evals/fake-supabase.ts). See docs/QUERY_AGENT_EVALS.md.
 *
 *   bun run eval                                       # all cases, 3 runs each, production models
 *   bun run eval -- --filter q- --runs 1               # only ids containing "q-", single run
 *   bun run eval -- --label baseline-router
 *   bun run eval -- --config evals/configs/x.json      # architecture and models per phase
 *   bun run eval -- --arch single --primary google/gemini-2.5-flash
 *   bun run eval -- --compare 20261007T0757-p0-7-router-lite   # baseline (default: latest full run)
 *   bun run eval -- --no-langfuse                      # don't upload to Langfuse
 *
 * Exit code is 1 when any case without `known_gap` has a pass rate below --min-pass, or a gate
 * (report.ts GATES) fails.
 */

import { appendFileSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { answerQuery, type AgentMode } from "../src/agent/answer.js";
import { MODEL_POLICY, MODEL_PRIORITY, describeError, type ModelPolicy } from "../src/agent/ai-gateway.js";
import { authGuard } from "../src/agent/auth-guard.js";
import type { QueryObserver, ObservedToolCall, RouteDecision } from "../src/agent/observer.js";
import { entitiesFromHistory, toModelHistory, type StoredMessage } from "../src/agent/memory.js";
import type { Draft } from "../src/tools/types.js";
import { createFakeSupabase, type FakeAccess, type Tables } from "./fake-supabase.js";
import { buildManifest } from "./manifest.js";
import {
  buildMarkdown, caseStatuses, compareReports, computeMetrics, evaluateGates, findBaseline, loadCases, loadReport, logRow,
  type CheckResult, type EvalCase, type EvalReport, type RunAttempt, type RunResult, type RunStep,
} from "./report.js";
import { langfuseConfigured, uploadReport } from "./langfuse.js";

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(EVALS_DIR, "reports");
/** Experiment log: each full run adds a row; the TPM fills in the decision. */
const EVAL_LOG = join(EVALS_DIR, "..", "..", "docs", "QUERY_AGENT_EVALS.md");
const EVAL_USER_ID = "0a000000-0000-4000-8000-000000000001";
const EVAL_ORG_ID = "0e000000-0000-4000-8000-000000000001";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ── CLI args ──────────────────────────────────────────────────────────────────

/** evals/configs/*.json: a configuration to compare. Missing fields use production settings. */
interface EvalConfig {
  arch?: AgentMode;
  models?: ModelPolicy;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const configPath = get("--config");
  const config: EvalConfig = configPath ? JSON.parse(readFileSync(resolve(configPath), "utf8")) : {};
  const archFlag = get("--arch");
  const arch: AgentMode = archFlag === "single" || archFlag === "router" ? archFlag : config.arch ?? "router";

  // --primary moves one model to the front of every phase's list, as before per-phase policies.
  const primary = get("--primary");
  let policy: ModelPolicy = config.models ?? MODEL_POLICY;
  if (primary) policy = { default: [primary, ...MODEL_PRIORITY.filter((id) => id !== primary)] };

  return {
    runs: Number(get("--runs") ?? 3),
    filter: get("--filter"),
    label: get("--label") ?? "run",
    concurrency: Number(get("--concurrency") ?? 4),
    minPass: Number(get("--min-pass") ?? 0.66), // 2 of 3 runs
    arch,
    policy,
    compare: get("--compare"),
    langfuse: !args.includes("--no-langfuse"),
    verbose: args.includes("--verbose"),
  };
}

// ── Loading ───────────────────────────────────────────────────────────────────

const fixtureCache = new Map<string, Tables>();
function loadFixtures(name: string): Tables {
  if (!fixtureCache.has(name)) {
    fixtureCache.set(name, JSON.parse(readFileSync(join(EVALS_DIR, "fixtures", `${name}.json`), "utf8")));
  }
  return fixtureCache.get(name)!;
}

// ── Checks ────────────────────────────────────────────────────────────────────

function argsMatch(actual: unknown, expected: Record<string, unknown>): boolean {
  if (!actual || typeof actual !== "object") return false;
  return Object.entries(expected).every(
    ([key, value]) => JSON.stringify((actual as Record<string, unknown>)[key]) === JSON.stringify(value)
  );
}

function evaluate(c: EvalCase, r: Omit<RunResult, "pass" | "checks">, arch: AgentMode): CheckResult[] {
  const checks: CheckResult[] = [];
  const e = c.expect;
  const called = new Set(r.toolCalls.map((t) => t.toolName));

  checks.push({ check: "no_error", pass: !r.error, detail: r.error });
  const leaked = r.reply.match(UUID_RE);
  checks.push({ check: "no_uuid_in_reply", pass: !leaked, detail: leaked?.[0] });

  for (const tool of e.tools_include ?? []) {
    checks.push({ check: `calls ${tool}`, pass: called.has(tool), detail: `called: ${[...called].join(", ") || "(none)"}` });
  }
  for (const tool of e.tools_exclude ?? []) {
    checks.push({ check: `does not call ${tool}`, pass: !called.has(tool) });
  }
  for (const { tool, args } of e.tool_args ?? []) {
    const ok = r.toolCalls.some((t) => t.toolName === tool && argsMatch(t.args, args));
    const seen = r.toolCalls.filter((t) => t.toolName === tool).map((t) => JSON.stringify(t.args));
    checks.push({ check: `${tool} args ⊇ ${JSON.stringify(args)}`, pass: ok, detail: seen.join(" | ") || "(not called)" });
  }
  // Which sub-agent the router picked has no meaning for the single agent.
  for (const agent of arch === "router" ? e.agents_include ?? [] : []) {
    checks.push({ check: `routes to ${agent}`, pass: !!r.route?.agents.includes(agent as never), detail: r.route?.agents.join(", ") });
  }

  // P0-5 invariant: writes only happen after the user confirms a card, never inside the agent loop.
  checks.push({ check: "agent loop writes nothing", pass: r.writes.length === 0, detail: r.writes.map((w) => `${w.op} ${w.table}`).join(", ") });
  const draftCounts: Record<string, number> = {};
  for (const d of r.drafts) draftCounts[d.tool] = (draftCounts[d.tool] ?? 0) + 1;
  if (e.no_drafts) checks.push({ check: "no drafts", pass: r.drafts.length === 0, detail: Object.keys(draftCounts).join(", ") });
  for (const [tool, expected] of Object.entries(e.drafts ?? {})) {
    const actual = draftCounts[tool] ?? 0;
    checks.push({ check: `drafts ${expected} × ${tool}`, pass: actual === expected, detail: `actual: ${actual}` });
  }

  for (const pattern of e.reply_matches ?? []) {
    checks.push({ check: `reply matches /${pattern}/`, pass: new RegExp(pattern).test(r.reply) });
  }
  for (const pattern of e.reply_not_matches ?? []) {
    checks.push({ check: `reply does not match /${pattern}/`, pass: !new RegExp(pattern).test(r.reply) });
  }
  return checks;
}

// ── Execution ─────────────────────────────────────────────────────────────────

const ROLES: Record<string, FakeAccess> = JSON.parse(readFileSync(join(EVALS_DIR, "fixtures", "roles.json"), "utf8"));

async function runOnce(c: EvalCase, run: number, arch: AgentMode, modelPolicy: ModelPolicy): Promise<RunResult> {
  const role = ROLES[c.role ?? "owner"];
  if (!role) throw new Error(`Unknown role "${c.role}" in case ${c.id} (see evals/fixtures/roles.json)`);
  const { client, writes } = createFakeSupabase(loadFixtures(c.fixtures ?? "basic"), EVAL_USER_ID, role);
  const toolCalls: ObservedToolCall[] = [];
  const drafts: Draft[] = [];
  const modelErrors: string[] = [];
  const attempts: RunAttempt[] = [];
  const steps: RunStep[] = [];
  let route: RouteDecision | undefined;
  let routeFromFallback = false;
  let tokens = 0;

  const observer: QueryObserver = {
    onRoute: (decision, fromFallback) => { route = decision; routeFromFallback = fromFallback; },
    onModelAttempt: ({ phase, modelId, startedAt, durationMs, calls, error }) => {
      if (error) modelErrors.push(`${phase} ${modelId}: ${(error as Error).message}`);
      attempts.push({ phase, modelId, startedAt, durationMs, calls, ...(error ? { error: describeError(error).slice(0, 500) } : {}) });
    },
    onStep: (agent, step) => {
      toolCalls.push(...step.toolCalls);
      steps.push({ agent, at: Date.now(), toolCalls: step.toolCalls });
      tokens += step.promptTokens + step.completionTokens;
    },
  };

  const startedAt = Date.now();
  let reply = "";
  let error: string | undefined;
  try {
    // Same permission path as production: the real authGuard against the fake database.
    const access = await authGuard(client, EVAL_ORG_ID);
    const ctx = { supabase: client, userId: access.userId, organizationId: access.organizationId };
    const history = (c.history ?? []) as StoredMessage[];
    reply = await answerQuery(c.message, ctx, access.allowedTools, toModelHistory(history), {
      observer,
      deadline: Date.now() + 90_000,
      entities: entitiesFromHistory(history),
      drafts,
      modelPolicy,
      captureModelIO: true,
    }, arch);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const partial = {
    caseId: c.id, run, reply, error, route, routeFromFallback, toolCalls, writes, drafts, modelErrors, tokens,
    latencyMs: Date.now() - startedAt, startedAt, attempts, steps,
  };
  const checks = evaluate(c, partial, arch);
  return { ...partial, checks, pass: checks.every((ch) => ch.pass) };
}

async function runPool<T>(tasks: (() => Promise<T>)[], concurrency: number, onDone: (r: T) => void): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
      onDone(results[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** The report as saved to disk: model inputs and outputs stay in Langfuse only, to keep reports small. */
function withoutModelIO(report: EvalReport): EvalReport {
  return {
    ...report,
    results: report.results.map((r) => ({
      ...r,
      attempts: r.attempts?.map((a) => ({ ...a, calls: a.calls.map(({ input: _input, output: _output, ...call }) => call) })),
    })),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

async function main() {
  const opts = parseArgs();
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required (run via `bun run eval`, which loads .env)");

  const allCases = loadCases(join(EVALS_DIR, "cases"));
  const cases = opts.filter ? allCases.filter((c) => c.id.includes(opts.filter!)) : allCases;
  if (!cases.length) throw new Error(`No eval cases match filter "${opts.filter}"`);

  // The gateway and router log every model failure; keep the eval output readable.
  const restore = { warn: console.warn, error: console.error };
  if (!opts.verbose) {
    console.warn = () => {};
    console.error = () => {};
  }

  const manifest = buildManifest(opts.arch, opts.policy, cases, EVALS_DIR);
  const createdAt = new Date().toISOString();
  console.log(`Running ${cases.length} cases × ${opts.runs} runs (arch ${opts.arch}, concurrency ${opts.concurrency})…`);
  for (const [phase, ids] of Object.entries(manifest.models)) console.log(`  ${phase}: ${ids.join(" → ")}`);
  const tasks = cases.flatMap((c) => Array.from({ length: opts.runs }, (_, i) => () => runOnce(c, i + 1, opts.arch, opts.policy)));
  const results = await runPool(tasks, opts.concurrency, (r) => process.stdout.write(r.pass ? "." : "F"));
  process.stdout.write("\n");
  Object.assign(console, restore);

  const id = `${createdAt.replace(/[-:]/g, "").slice(0, 13)}-${opts.label}`;
  const caseInfos = cases.map(({ id: caseId, name, category, known_gap }) => ({ id: caseId, name, category, ...(known_gap ? { known_gap } : {}) }));
  const metrics = computeMetrics(caseInfos, results);
  const report: EvalReport = {
    version: 2, id, label: opts.label, createdAt, ...(opts.filter ? { filter: opts.filter } : {}),
    runs: opts.runs, minPass: opts.minPass, manifest, cases: caseInfos, metrics, gates: evaluateGates(metrics), results,
  };

  const baseline = opts.compare
    ? loadReport(join(REPORTS_DIR, opts.compare.endsWith(".json") ? opts.compare : `${opts.compare}.json`), allCases)
    : findBaseline(REPORTS_DIR, allCases, { id, manifest });
  const comparison = baseline ? compareReports(baseline, report) : null;

  mkdirSync(REPORTS_DIR, { recursive: true });
  const base = join(REPORTS_DIR, id);
  writeFileSync(`${base}.md`, buildMarkdown(report, comparison));
  writeFileSync(`${base}.json`, JSON.stringify(withoutModelIO(report), null, 2));
  // The log table is the last section of the document, so a row is appended at the end.
  if (!opts.filter && existsSync(EVAL_LOG)) appendFileSync(EVAL_LOG, `${logRow(report, comparison)}\n`);

  const cost = metrics.costPerCompletedTask === null ? "—" : `US$${metrics.costPerCompletedTask.toFixed(5)}`;
  console.log(`\n任務完成率 ${pct(metrics.taskCompletion)}｜Router 分派 ${pct(metrics.routing)}｜每個完成任務 ${cost}｜P50 ${metrics.latencyMs.p50} ms｜P90 ${metrics.latencyMs.p90} ms`);
  for (const g of report.gates) console.log(`${g.pass ? "✅" : "❌"} ${g.label} ${pct(g.value)}（≥ ${pct(g.min)}）`);
  if (comparison) {
    console.log(`與基準 ${comparison.baselineId} 比較：退步 ${comparison.regressed.join(", ") || "無"}｜修好 ${comparison.fixed.join(", ") || "無"}`);
  }
  console.log(`報告：${base}.md`);

  if (opts.langfuse && langfuseConfigured()) {
    try {
      const url = await uploadReport(report, allCases);
      console.log(`Langfuse：${url}`);
    } catch (err) {
      console.log(`Langfuse 上傳失敗（報告已存在本機）：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const failing = [...caseStatuses(report)].filter(([, status]) => status === "❌").map(([caseId]) => caseId);
  const failedGates = report.gates.filter((g) => !g.pass);
  if (failing.length) console.log(`未達門檻的案例：${failing.join(", ")}`);
  if (failing.length || failedGates.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
