/**
 * Query Agent eval runner — replays cases against the real agent pipeline and real models,
 * with an in-memory fake database (evals/fake-supabase.ts). See docs/QUERY_AGENT_PHASE0.md §4.7.
 *
 *   bun run eval                          # all cases, 3 runs each
 *   bun run eval -- --filter q- --runs 1  # only ids containing "q-", single run
 *   bun run eval -- --label baseline-router
 *
 * Exit code is 1 when any case without `known_gap` has a pass rate below --min-pass.
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { answerQuery, type AgentMode } from "../src/agent/answer.js";
import { MODEL_PRIORITY, modelsFor, type GatewayModel } from "../src/agent/ai-gateway.js";
import { authGuard } from "../src/agent/auth-guard.js";
import type { QueryObserver, ObservedToolCall, RouteDecision } from "../src/agent/observer.js";
import { entitiesFromHistory, toModelHistory, type StoredMessage } from "../src/agent/memory.js";
import type { Draft } from "../src/tools/types.js";
import { createFakeSupabase, type FakeAccess, type RecordedWrite, type Tables } from "./fake-supabase.js";

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const EVAL_USER_ID = "0a000000-0000-4000-8000-000000000001";
const EVAL_ORG_ID = "0e000000-0000-4000-8000-000000000001";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ── Types ─────────────────────────────────────────────────────────────────────

interface EvalExpect {
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

interface EvalCase {
  id: string;
  name: string;
  note?: string;
  known_gap?: string;
  fixtures?: string;
  role?: string;
  /** May carry metadata.entities, as replies saved by the server do. */
  history?: StoredMessage[];
  message: string;
  expect: EvalExpect;
}

interface CheckResult {
  check: string;
  pass: boolean;
  detail?: string;
}

interface RunResult {
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
  tokens: number;
  latencyMs: number;
}

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    runs: Number(get("--runs") ?? 3),
    filter: get("--filter"),
    label: get("--label") ?? "run",
    concurrency: Number(get("--concurrency") ?? 4),
    minPass: Number(get("--min-pass") ?? 0.66), // 2 of 3 runs
    arch: (get("--arch") === "single" ? "single" : "router") as AgentMode,
    /** Model to try first; the rest of MODEL_PRIORITY follows as fallbacks. */
    primary: get("--primary"),
    verbose: args.includes("--verbose"),
  };
}

// ── Loading ───────────────────────────────────────────────────────────────────

function loadCases(filter?: string): EvalCase[] {
  const dir = join(EVALS_DIR, "cases");
  const cases = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as EvalCase[]);
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`Duplicate eval case id: ${c.id}`);
    ids.add(c.id);
  }
  return filter ? cases.filter((c) => c.id.includes(filter)) : cases;
}

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

async function runOnce(c: EvalCase, run: number, arch: AgentMode, models?: GatewayModel[]): Promise<RunResult> {
  const role = ROLES[c.role ?? "owner"];
  if (!role) throw new Error(`Unknown role "${c.role}" in case ${c.id} (see evals/fixtures/roles.json)`);
  const { client, writes } = createFakeSupabase(loadFixtures(c.fixtures ?? "basic"), EVAL_USER_ID, role);
  const toolCalls: ObservedToolCall[] = [];
  const drafts: Draft[] = [];
  const modelErrors: string[] = [];
  let route: RouteDecision | undefined;
  let routeFromFallback = false;
  let tokens = 0;

  const observer: QueryObserver = {
    onRoute: (decision, fromFallback) => { route = decision; routeFromFallback = fromFallback; },
    onModelAttempt: ({ phase, modelId, error }) => { if (error) modelErrors.push(`${phase} ${modelId}: ${(error as Error).message}`); },
    onStep: (_agent, step) => {
      toolCalls.push(...step.toolCalls);
      tokens += step.promptTokens + step.completionTokens;
    },
  };

  const started = Date.now();
  let reply = "";
  let error: string | undefined;
  try {
    // Same permission path as production: the real authGuard against the fake database.
    const access = await authGuard(client, EVAL_ORG_ID);
    const ctx = { supabase: client, userId: access.userId, organizationId: access.organizationId };
    const history = c.history ?? [];
    reply = await answerQuery(c.message, ctx, access.allowedTools, toModelHistory(history), {
      observer,
      deadline: Date.now() + 90_000,
      entities: entitiesFromHistory(history),
      drafts,
      models,
    }, arch);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const partial = { caseId: c.id, run, reply, error, route, routeFromFallback, toolCalls, writes, drafts, modelErrors, tokens, latencyMs: Date.now() - started };
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

// ── Reporting ─────────────────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
}

const TOOL_CHECK_RE = /^(calls |does not call |\S+ args ⊇ )/;

function buildReport(label: string, cases: EvalCase[], results: RunResult[], runs: number, minPass: number, arch: AgentMode, primary: string) {
  const byCase = new Map(cases.map((c) => [c.id, results.filter((r) => r.caseId === c.id)]));
  const gated = results.filter((r) => !cases.find((c) => c.id === r.caseId)?.known_gap);

  const toolRuns = gated.filter((r) => r.checks.some((ch) => TOOL_CHECK_RE.test(ch.check)));
  const toolPass = toolRuns.filter((r) => r.checks.filter((ch) => TOOL_CHECK_RE.test(ch.check)).every((ch) => ch.pass));
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

  const metrics = {
    taskCompletion: pct(gated.filter((r) => r.pass).length, gated.length),
    toolSelection: pct(toolPass.length, toolRuns.length),
    errorRate: pct(gated.filter((r) => r.error).length, gated.length),
    fallbackRate: pct(gated.filter((r) => r.modelErrors.length > 0).length, gated.length),
    avgLatencyMs: avg(gated.map((r) => r.latencyMs)),
    avgSubAgentTokens: avg(gated.map((r) => r.tokens)),
  };

  const failing = cases.filter((c) => {
    const rs = byCase.get(c.id)!;
    return !c.known_gap && rs.filter((r) => r.pass).length / rs.length < minPass;
  });

  const lines: string[] = [
    `# Query Agent Eval — ${label}`,
    "",
    `- 時間：${new Date().toISOString()}`,
    `- 案例：${cases.length}（每案 ${runs} 次）；通過門檻 ${Math.round(minPass * 100)}%`,
    `- 架構：${arch}；主模型：${primary}`,
    "",
    "## 指標（不含 known_gap 案例）",
    "",
    "| 指標 | 數值 |",
    "|------|------|",
    `| 任務完成率（全部檢查通過） | ${metrics.taskCompletion} |`,
    `| Tool 選擇正確率 | ${metrics.toolSelection} |`,
    `| 錯誤率（請求拋出例外） | ${metrics.errorRate} |`,
    `| 降級率（至少一個模型失敗） | ${metrics.fallbackRate} |`,
    `| 平均延遲 | ${metrics.avgLatencyMs} ms |`,
    `| 平均 token（僅子 Agent） | ${metrics.avgSubAgentTokens} |`,
    "",
    "## 各案例",
    "",
    "| 案例 | 通過 | 路由 | 呼叫的 tools |",
    "|------|------|------|--------------|",
  ];
  for (const c of cases) {
    const rs = byCase.get(c.id)!;
    const passed = rs.filter((r) => r.pass).length;
    const mark = c.known_gap ? "🚧" : passed / rs.length >= minPass ? "✅" : "❌";
    const routes = [...new Set(rs.map((r) => (r.route?.agents.join("+") ?? "—") + (r.routeFromFallback ? "(fallback)" : "")))].join(" / ");
    const tools = [...new Set(rs.flatMap((r) => r.toolCalls.map((t) => t.toolName)))].join(", ") || "—";
    lines.push(`| ${mark} \`${c.id}\` ${c.name} | ${passed}/${rs.length} | ${routes} | ${tools} |`);
  }

  lines.push("", "## 失敗明細", "");
  for (const c of cases) {
    const failedRuns = byCase.get(c.id)!.filter((r) => !r.pass);
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

  return { markdown: lines.join("\n"), metrics, failing };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required (run via `bun run eval`, which loads .env)");

  const cases = loadCases(opts.filter);
  if (!cases.length) throw new Error(`No eval cases match filter "${opts.filter}"`);

  // The gateway and router log every model failure; keep the eval output readable.
  const restore = { warn: console.warn, error: console.error };
  if (!opts.verbose) {
    console.warn = () => {};
    console.error = () => {};
  }

  const models = opts.primary ? modelsFor([opts.primary, ...MODEL_PRIORITY.filter((id) => id !== opts.primary)]) : undefined;
  console.log(`Running ${cases.length} cases × ${opts.runs} runs (arch ${opts.arch}, primary ${opts.primary ?? MODEL_PRIORITY[0]}, concurrency ${opts.concurrency})…`);
  const tasks = cases.flatMap((c) => Array.from({ length: opts.runs }, (_, i) => () => runOnce(c, i + 1, opts.arch, models)));
  const results = await runPool(tasks, opts.concurrency, (r) => process.stdout.write(r.pass ? "." : "F"));
  process.stdout.write("\n");
  Object.assign(console, restore);

  const { markdown, metrics, failing } = buildReport(opts.label, cases, results, opts.runs, opts.minPass, opts.arch, opts.primary ?? MODEL_PRIORITY[0]);
  const reportsDir = join(EVALS_DIR, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
  const base = join(reportsDir, `${stamp}-${opts.label}`);
  writeFileSync(`${base}.md`, markdown);
  writeFileSync(`${base}.json`, JSON.stringify({ label: opts.label, arch: opts.arch, primary: opts.primary ?? MODEL_PRIORITY[0], metrics, results }, null, 2));

  console.log(`\n任務完成率 ${metrics.taskCompletion}｜Tool 選擇 ${metrics.toolSelection}｜錯誤率 ${metrics.errorRate}｜降級率 ${metrics.fallbackRate}｜平均 ${metrics.avgLatencyMs} ms`);
  console.log(`報告：${base}.md`);
  if (failing.length) {
    console.log(`未達門檻：${failing.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
