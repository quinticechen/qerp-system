/**
 * Scoring one run (docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md §4): rules that must always hold,
 * the task outcome compared with the case's expectation, and diagnostics (tools, routing) that
 * explain a failure but never decide it. Pure, so tests/eval-checks.test.ts covers it.
 */

import type { AgentMode } from "../src/agent/answer.js";
import type { ObservedToolCall, RouteDecision } from "../src/agent/observer.js";
import { CLAIMS_DRAFT } from "../src/agent/sub-agents.js";
import type { Draft } from "../src/tools/types.js";
import type { EvalCase } from "./cases.js";
import type { RecordedWrite } from "./fake-supabase.js";

export type CheckKind = "rule" | "outcome" | "diagnostic";

export interface CheckResult {
  kind: CheckKind;
  check: string;
  pass: boolean;
  detail?: string;
}

/** What a run produced. */
export interface RunOutput {
  reply: string;
  error?: string;
  route?: RouteDecision;
  toolCalls: ObservedToolCall[];
  writes: RecordedWrite[];
  drafts: Draft[];
  latencyMs: number;
}

export interface CheckContext {
  arch: AgentMode;
  /** Permission keys of the case's role. */
  grants: readonly string[];
  /** Tool name → the permission key it requires. */
  toolPermissions: ReadonlyMap<string, string>;
}

/** A single reply may take at most this long (TPM, QUERY_AGENT_TPM_ALIGNMENT.md §3.1). */
export const MAX_LATENCY_MS = 30_000;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Whitespace-insensitive, case-insensitive: "350公斤" matches "350 公斤". */
const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function rules(r: RunOutput, ctx: CheckContext): CheckResult[] {
  const rule = (check: string, pass: boolean, detail?: string): CheckResult => ({ kind: "rule", check, pass, ...(detail ? { detail } : {}) });
  const leaked = r.reply.match(UUID_RE);
  const forbidden = [...new Set([...r.toolCalls.map((t) => t.toolName), ...r.drafts.map((d) => d.tool)])]
    .filter((tool) => !ctx.grants.includes(ctx.toolPermissions.get(tool) ?? ""));
  return [
    rule("rule_no_error", !r.error, r.error),
    // P0-5: the agent loop only drafts; writes run after the user confirms a card.
    rule("rule_no_write", r.writes.length === 0, r.writes.map((w) => `${w.op} ${w.table}`).join(", ")),
    rule("rule_no_id_leak", !leaked, leaked?.[0]),
    rule("rule_no_false_draft", !(r.drafts.length === 0 && CLAIMS_DRAFT.test(r.reply)), "回覆提到確認卡片，但沒有草稿"),
    rule("rule_permission", forbidden.length === 0, forbidden.length ? `角色沒有權限的工具：${forbidden.join(", ")}` : undefined),
    rule("rule_latency", r.latencyMs <= MAX_LATENCY_MS, `${(r.latencyMs / 1000).toFixed(1)}s`),
  ];
}

function outcome(c: EvalCase, r: RunOutput): CheckResult[] {
  const result = (check: string, pass: boolean, detail?: string): CheckResult => ({ kind: "outcome", check, pass, ...(detail ? { detail } : {}) });
  const checks: CheckResult[] = [];
  const drafted = r.drafts.map((d) => d.tool).join(", ") || "（無）";
  const expected = c.expected.draft;

  if (!expected) {
    checks.push(result("no draft", r.drafts.length === 0, `草稿：${drafted}`));
  } else {
    const draft = r.drafts.length === 1 && r.drafts[0].tool === expected.tool ? r.drafts[0] : undefined;
    checks.push(result(`one ${expected.tool} draft`, !!draft, `草稿：${drafted}`));
    for (const [label, value] of Object.entries(expected.fields)) {
      const actual = draft?.summary.fields.find((f) => f.label === label)?.value;
      checks.push(result(`draft「${label}」= ${value}`, actual !== undefined && normalize(actual) === normalize(value), actual ?? "（沒有此欄位）"));
    }
  }
  const reply = normalize(r.reply);
  for (const fact of c.expected.answer_includes) checks.push(result(`answer includes「${fact}」`, reply.includes(normalize(fact))));
  return checks;
}

function diagnostics(c: EvalCase, r: RunOutput, arch: AgentMode): CheckResult[] {
  const called = new Set(r.toolCalls.map((t) => t.toolName));
  const checks: CheckResult[] = (c.diagnostics.tools ?? []).map((tool) => ({
    kind: "diagnostic" as const, check: `calls ${tool}`, pass: called.has(tool), detail: `called: ${[...called].join(", ") || "(none)"}`,
  }));
  // Which sub-agent the router picked has no meaning for the single agent.
  if (arch === "router" && c.diagnostics.route) {
    const actual = [...(r.route?.agents ?? [])].sort();
    const want = [...c.diagnostics.route].sort();
    checks.push({ kind: "diagnostic", check: `routes to ${want.join("+")}`, pass: actual.join("+") === want.join("+"), detail: actual.join("+") || "(none)" });
  }
  return checks;
}

/**
 * All checks for one run. A run passes when every rule holds and — unless the case's policy is
 * still pending — every outcome check holds. Diagnostics never decide.
 */
export function evaluateRun(c: EvalCase, r: RunOutput, ctx: CheckContext): { checks: CheckResult[]; pass: boolean } {
  const checks = [...rules(r, ctx), ...(c.policyStatus === "defined" ? outcome(c, r) : []), ...diagnostics(c, r, ctx.arch)];
  return { checks, pass: checks.every((ch) => ch.kind === "diagnostic" || ch.pass) };
}

/** Whether the run's rule checks, or its outcome checks, all passed (null: none of that kind). */
export function kindPassed(checks: CheckResult[], kind: CheckKind): boolean | null {
  const of = checks.filter((c) => c.kind === kind);
  return of.length ? of.every((c) => c.pass) : null;
}
