/**
 * Query Agent eval runner — replays the Langfuse dataset's cases against the real agent pipeline
 * and real models, with an in-memory fake database (evals/fake-supabase.ts). See
 * docs/QUERY_AGENT_EVALS.md and docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md.
 *
 *   bun run eval                                       # all cases, 3 runs each, production models
 *   bun run eval -- --filter order- --runs 1           # only ids containing "order-", single run
 *   bun run eval -- --label baseline-router
 *   bun run eval -- --config evals/configs/x.json      # architecture and models per phase
 *   bun run eval -- --arch single --primary google/gemini-2.5-flash
 *   bun run eval -- --dataset-version 2026-10-14T08:00:00Z   # the dataset as of that time
 *   bun run eval -- --offline                          # newest snapshot in evals/snapshots/, no Langfuse
 *   bun run eval -- --snapshot <file>                  # a given snapshot
 *   bun run eval -- --compare <report id>              # baseline (default: latest comparable full run)
 *   bun run eval -- --skip-db-check                    # don't check the fake data against the database
 *   bun run eval -- --no-langfuse                      # run locally only, no Langfuse experiment
 *   bun run eval -- --no-judge                         # skip the LLM judge (evals/judge.ts)
 *   bun run eval -- --prompt-label candidate           # Langfuse prompts with that label (default: in-code prompts)
 *
 * With Langfuse configured the run is a Langfuse experiment on the dataset (evals/experiment.ts):
 * traces, generations and scores go to Langfuse as it runs, and the report stays local as well.
 *
 * Before any model is called: every case must parse (evals/cases.ts) and the fake data must match
 * the database (evals/db-check.ts). Exit code is 1 when either fails, when a scored case's pass
 * rate is below --min-pass, or when a gate (report.ts GATES) fails.
 */

import { appendFileSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { answerQuery, type AgentMode } from "../src/agent/answer.js";
import { MODEL_POLICY, MODEL_PRIORITY, describeError, type ModelPolicy } from "../src/agent/ai-gateway.js";
import { authGuard } from "../src/agent/auth-guard.js";
import type { QueryObserver, ObservedToolCall, RouteDecision } from "../src/agent/observer.js";
import { entitiesFromHistory, toModelHistory, type StoredMessage } from "../src/agent/memory.js";
import { getAllTools } from "../src/tools/index.js";
import type { Draft } from "../src/tools/types.js";
import {
  DATASET_NAME, fetchDatasetItems, langfuseConfigured, loadSnapshot, parseItems, saveSnapshot, unscoredReason,
  type EvalCase, type Snapshot,
} from "./cases.js";
import { evaluateRun } from "./checks.js";
import { JUDGE_MODEL, judgeRun } from "./judge.js";
import { checkDatabase } from "./db-check.js";
import { fakeApiParams } from "./fake-api.js";
import { createFakeSupabase, type FakeAccess, type Tables } from "./fake-supabase.js";
import { buildManifest, codePromptTexts, type PromptSet } from "./manifest.js";
import { setPromptLabel, systemPrompt } from "../src/agent/prompts.js";
import { flushTracing, langfuseClient, shutdownTracing, startTracing } from "../src/agent/langfuse.js";
import {
  buildMarkdown, caseStatuses, compareReports, computeMetrics, evaluateGates, findBaseline, gateRequirement, gateValue,
  loadReport, logRow, type CaseInfo, type EvalReport, type LangfuseRunRef, type RunAttempt, type RunResult, type RunStep,
} from "./report.js";
import { ensureScoreConfigs, runExperiment, type RunInSpan } from "./experiment.js";

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(EVALS_DIR, "reports");
const SNAPSHOTS_DIR = join(EVALS_DIR, "snapshots");
const PROJECT_DIR = join(EVALS_DIR, "..", "..");
/** Experiment log: each full run adds a row; the TPM fills in the decision. */
const EVAL_LOG = join(PROJECT_DIR, "docs", "QUERY_AGENT_EVALS.md");
const EVAL_USER_ID = "0a000000-0000-4000-8000-000000000001";
const EVAL_ORG_ID = "0e000000-0000-4000-8000-000000000001";

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
    datasetVersion: get("--dataset-version"),
    snapshot: get("--snapshot"),
    offline: args.includes("--offline"),
    dbCheck: !args.includes("--skip-db-check"),
    judge: !args.includes("--no-judge"),
    promptLabel: get("--prompt-label") ?? null,
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

const ROLES: Record<string, FakeAccess> = Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(join(EVALS_DIR, "fixtures", "roles.json"), "utf8")) as Record<string, unknown>)
    .filter(([role]) => !role.startsWith("_")) as [string, FakeAccess][]
);
const TOOL_PERMISSIONS = new Map(getAllTools().map((t) => [t.name as string, t.permission as string]));

/** The cases from Langfuse (saved as a snapshot) or from a snapshot. */
async function loadCases(opts: ReturnType<typeof parseArgs>): Promise<{ cases: EvalCase[]; dataset: EvalReport["dataset"] }> {
  const local = opts.offline || opts.snapshot ? loadSnapshot(SNAPSHOTS_DIR, opts.snapshot) : null;
  if (!local && !langfuseConfigured()) throw new Error("需要 LANGFUSE_PUBLIC_KEY、LANGFUSE_SECRET_KEY、LANGFUSE_BASE_URL 才能讀取案例；離線請用 --offline");
  const snapshot: Snapshot = local?.snapshot
    ?? { dataset: DATASET_NAME, version: opts.datasetVersion ?? null, fetchedAt: new Date().toISOString(), items: await fetchDatasetItems(opts.datasetVersion) };
  const { cases, errors } = parseItems(snapshot.items, { tools: [...TOOL_PERMISSIONS.keys()], roles: Object.keys(ROLES) });
  if (errors.length) {
    throw new Error(`${errors.length} 個案例格式不正確（docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md §3）：\n- ${errors.join("\n- ")}`);
  }
  // Only a valid case set is saved, so every snapshot can be run.
  const snapshotName = local?.name ?? saveSnapshot(SNAPSHOTS_DIR, snapshot);
  return { cases, dataset: { name: snapshot.dataset, version: snapshot.version, snapshot: snapshotName } };
}

// ── Execution ─────────────────────────────────────────────────────────────────

async function runOnce(c: EvalCase, run: number, arch: AgentMode, modelPolicy: ModelPolicy, judge: boolean): Promise<RunResult> {
  const role = ROLES[c.input.role];
  const { client, writes } = createFakeSupabase(loadFixtures(c.input.fixtures), EVAL_USER_ID, role);
  const toolCalls: ObservedToolCall[] = [];
  const drafts: Draft[] = [];
  const modelErrors: string[] = [];
  const attempts: RunAttempt[] = [];
  const steps: RunStep[] = [];
  let route: RouteDecision | undefined;
  let routeFromFallback = false;

  const observer: QueryObserver = {
    onRoute: (decision, fromFallback) => { route = decision; routeFromFallback = fromFallback; },
    onModelAttempt: ({ phase, modelId, startedAt, durationMs, calls, error }) => {
      if (error) modelErrors.push(`${phase} ${modelId}: ${(error as Error).message}`);
      attempts.push({ phase, modelId, startedAt, durationMs, calls, ...(error ? { error: describeError(error).slice(0, 500) } : {}) });
    },
    onStep: (agent, step) => {
      toolCalls.push(...step.toolCalls);
      steps.push({ agent, at: Date.now(), toolCalls: step.toolCalls });
    },
  };

  const startedAt = Date.now();
  let reply = "";
  let error: string | undefined;
  try {
    // Same permission path as production: the real authGuard against the fake database.
    const access = await authGuard(client, EVAL_ORG_ID);
    const ctx = { supabase: client, userId: access.userId, organizationId: access.organizationId };
    const history = c.input.history as StoredMessage[];
    reply = await answerQuery(c.input.message, ctx, access.allowedTools, toModelHistory(history), {
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

  const output = { reply, error, route, toolCalls, writes, drafts, latencyMs: Date.now() - startedAt };
  const { checks, pass } = evaluateRun(c, output, { arch, grants: role.grants, toolPermissions: TOOL_PERMISSIONS });
  const verdict = judge ? await judgeRun(c, output) : undefined;
  return { caseId: c.id, run, ...output, routeFromFallback, modelErrors, startedAt, attempts, steps, checks, pass, ...(verdict !== undefined ? { judge: verdict } : {}) };
}

/** A case's runs, one after another; in an experiment each run is a span of the case's trace. */
async function runCase(c: EvalCase, opts: ReturnType<typeof parseArgs>, runInSpan: RunInSpan): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (let run = 1; run <= opts.runs; run++) {
    const r = await runInSpan(run, () => runOnce(c, run, opts.arch, opts.policy, opts.judge));
    process.stdout.write(r.pass ? "." : "F");
    results.push(r);
  }
  return results;
}

/** Without Langfuse: the same cases and runs, locally. */
async function runLocally(cases: EvalCase[], opts: ReturnType<typeof parseArgs>): Promise<RunResult[]> {
  const byCase: RunResult[][] = new Array(cases.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(opts.concurrency, cases.length) }, async () => {
    while (next < cases.length) {
      const i = next++;
      byCase[i] = await runCase(cases[i], opts, (_run, fn) => fn());
    }
  });
  await Promise.all(workers);
  return byCase.flat();
}

/** The report as saved to disk: model inputs and outputs stay in Langfuse only, to keep reports small. */
function withoutModelIO(report: EvalReport): EvalReport {
  return {
    ...report,
    results: report.results.map((r) => ({
      ...r,
      attempts: r.attempts.map((a) => ({ ...a, calls: a.calls.map(({ input: _input, output: _output, ...call }) => call) })),
    })),
  };
}

function caseInfo(c: EvalCase): CaseInfo {
  const unscored = unscoredReason(c);
  return { id: c.id, itemId: c.itemId, name: c.name, category: c.category, domain: c.domain, expectsDraft: !!c.expected.draft, ...(unscored ? { unscored } : {}) };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

async function main() {
  const opts = parseArgs();
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required (run via `bun run eval`, which loads .env)");

  const useLangfuse = opts.langfuse && langfuseConfigured();
  const { cases: allCases, dataset } = await loadCases(opts);
  const cases = opts.filter ? allCases.filter((c) => c.id.includes(opts.filter!)) : allCases;
  if (!cases.length) throw new Error(opts.filter ? `No eval cases match filter "${opts.filter}"` : `Dataset「${dataset.name}」沒有案例`);
  console.log(`案例：${cases.length}（dataset ${dataset.name}${dataset.version ? ` @ ${dataset.version}` : ""}；快照 ${dataset.snapshot}）`);

  if (opts.dbCheck) {
    const fixtures = Object.fromEntries([...new Set(cases.map((c) => c.input.fixtures))].map((name) => [name, loadFixtures(name)]));
    const issues = await checkDatabase({
      fixtures, roles: ROLES, apiParams: fakeApiParams(),
      toolsDir: join(EVALS_DIR, "..", "src", "tools"),
      fakeApiSource: readFileSync(join(EVALS_DIR, "fake-api.ts"), "utf8"),
      apiDoc: readFileSync(join(PROJECT_DIR, "docs", "API.md"), "utf8"),
      rootEnvPath: join(PROJECT_DIR, ".env"),
    });
    if (issues.length) {
      throw new Error(`假資料與資料庫不一致（evals/db-check.ts），請先更新 fixtures／fake-api.ts，或以 --skip-db-check 略過：\n- ${issues.map((i) => `${i.check}：${i.detail}`).join("\n- ")}`);
    }
    console.log("資料庫一致性檢查：通過");
  } else {
    console.log("資料庫一致性檢查：略過（這次執行不會被當成基準）");
  }

  // The gateway and router log every model failure; keep the eval output readable.
  const restore = { warn: console.warn, error: console.error };
  if (!opts.verbose) {
    console.warn = () => {};
    console.error = () => {};
  }

  // Prompts: the in-code text by default; with --prompt-label every prompt must come from Langfuse.
  setPromptLabel(opts.promptLabel);
  let promptSet: PromptSet | undefined;
  if (opts.promptLabel) {
    const names = Object.keys(codePromptTexts());
    const fetched = (await Promise.all(names.map((n) => systemPrompt(n, "")))).map((p) => ({ text: p.text, version: p.link!.version }));
    promptSet = {
      label: opts.promptLabel,
      versions: Object.fromEntries(names.map((n, i) => [n, fetched[i].version])),
      texts: Object.fromEntries(names.map((n, i) => [n, fetched[i].text])),
    };
    console.log(`Prompt：Langfuse 標籤 ${opts.promptLabel}（${names.map((n, i) => `${n} v${fetched[i].version}`).join("、")}）`);
  }
  const manifest = buildManifest(opts.arch, opts.policy, cases, EVALS_DIR, promptSet);
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[-:]/g, "").slice(0, 13)}-${opts.label}`;
  const caseInfos = cases.map(caseInfo);
  console.log(`Running ${cases.length} cases × ${opts.runs} runs (arch ${opts.arch}, concurrency ${opts.concurrency})…`);
  for (const [phase, ids] of Object.entries(manifest.models)) console.log(`  ${phase}: ${ids.join(" → ")}`);
  console.log(opts.judge ? `  LLM 評分：${JUDGE_MODEL}（只記錄，不計入門檻）` : "  LLM 評分：略過");

  let results: RunResult[];
  let experimentUrl: string | undefined;
  let langfuseRuns: Record<string, LangfuseRunRef> | undefined;
  if (useLangfuse) {
    // Experiment traces are fake data: every one is sent, unmasked.
    startTracing({ environment: "sdk-experiment", sampleRate: 1, mask: false });
    const langfuse = langfuseClient();
    const [configIds, langfuseDataset] = await Promise.all([ensureScoreConfigs(langfuse), langfuse.api.datasets.get(DATASET_NAME)]);
    const { arch, models, hashes, git, prompts } = manifest;
    ({ results, url: experimentUrl, runs: langfuseRuns } = await runExperiment({
      langfuse, runName: id, description: opts.label,
      metadata: { label: opts.label, arch, models, hashes, git, prompts, dataset, ...(opts.filter ? { filter: opts.filter } : {}) },
      datasetId: langfuseDataset.id, ...(dataset.version ? { datasetVersion: dataset.version } : {}),
      cases, infos: new Map(caseInfos.map((c) => [c.id, c])), configIds, concurrency: opts.concurrency,
      runCase: (c, runInSpan) => runCase(c, opts, runInSpan),
      status: (caseId, runs) => caseStatuses({ cases: caseInfos, results: runs, minPass: opts.minPass }).get(caseId),
      gates: (all) => {
        const m = computeMetrics(caseInfos, all);
        return { taskCompletion: m.taskCompletion, gates: evaluateGates(m) };
      },
    }));
    await flushTracing();
    await shutdownTracing();
  } else {
    results = await runLocally(cases, opts);
  }
  process.stdout.write("\n");
  Object.assign(console, restore);

  const metrics = computeMetrics(caseInfos, results);
  const report: EvalReport = {
    version: 3, id, label: opts.label, createdAt, ...(opts.filter ? { filter: opts.filter } : {}),
    runs: opts.runs, minPass: opts.minPass, manifest, dataset, dbCheck: opts.dbCheck ? "passed" : "skipped",
    cases: caseInfos, metrics, gates: evaluateGates(metrics), results,
    ...(langfuseRuns ? { langfuse: { ...(experimentUrl ? { experimentUrl } : {}), runs: langfuseRuns } } : {}),
  };

  const baseline = opts.compare
    ? loadReport(join(REPORTS_DIR, opts.compare.endsWith(".json") ? opts.compare : `${opts.compare}.json`))
    : existsSync(REPORTS_DIR) ? findBaseline(REPORTS_DIR, { id, manifest }) : null;
  if (opts.compare && !baseline) console.log(`--compare ${opts.compare} 不是 version 3 的報告，不比較`);
  const comparison = baseline ? compareReports(baseline, report) : null;

  mkdirSync(REPORTS_DIR, { recursive: true });
  const base = join(REPORTS_DIR, id);
  writeFileSync(`${base}.md`, buildMarkdown(report, comparison));
  writeFileSync(`${base}.json`, JSON.stringify(withoutModelIO(report), null, 2));
  // The log table is the last section of the document, so a row is appended at the end.
  if (!opts.filter && opts.dbCheck && existsSync(EVAL_LOG)) appendFileSync(EVAL_LOG, `${logRow(report, comparison)}\n`);

  const cost = metrics.costPerCompletedTask === null ? "—" : `US$${metrics.costPerCompletedTask.toFixed(5)}`;
  const ci = metrics.taskCompletionCI ? `（${pct(metrics.taskCompletionCI[0])}–${pct(metrics.taskCompletionCI[1])}）` : "";
  console.log(`\n任務完成率 ${pct(metrics.taskCompletion)}${ci}｜規則 ${pct(metrics.rules)}｜Router 分派（診斷）${pct(metrics.routing)}｜每個完成任務 ${cost}｜P50 ${metrics.latencyMs.p50} ms｜P90 ${metrics.latencyMs.p90} ms`);
  for (const g of report.gates) console.log(`${g.pass ? "✅" : "❌"} ${g.label} ${gateValue(g)}（${gateRequirement(g)}）`);
  if (comparison) {
    console.log(`與基準 ${comparison.baselineId} 比較：退步 ${comparison.regressed.join(", ") || "無"}｜修好 ${comparison.fixed.join(", ") || "無"}`);
  }
  console.log(`報告：${base}.md`);

  if (experimentUrl) console.log(`Langfuse：${experimentUrl}`);

  const failing = [...caseStatuses(report)].filter(([, status]) => status === "❌").map(([caseId]) => caseId);
  const failedGates = report.gates.filter((g) => !g.pass);
  if (failing.length) console.log(`未達門檻的案例：${failing.join(", ")}`);
  if (failing.length || failedGates.length) process.exit(1);
}

main().catch((err) => {
  // stderr directly: console.error is muted while cases run.
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
