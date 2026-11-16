/**
 * Scoring one run (docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md §4): rules that must always hold,
 * the task outcome compared with the case's expectation (draft, required tools, facts), and
 * diagnostics (other expected tools, routing) that explain a failure but never decide it. Pure, so tests/eval-checks.test.ts covers it.
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

/** A tool call with the agent that made it ("all" for the single agent, else the sub-agent group). */
export type AgentToolCall = ObservedToolCall & { agent?: string };

/** What a run produced. */
export interface RunOutput {
  reply: string;
  error?: string;
  route?: RouteDecision;
  toolCalls: AgentToolCall[];
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
  /** Names of other organizations' records in the case's fixtures; none may appear in a reply. */
  foreignNames?: readonly string[];
}

/** Row fields that name a record to a user: names and document numbers. */
const IDENTIFYING_FIELDS = ["name", "product_name", "order_number", "po_number", "shipping_number", "receipt_number"];

/**
 * Names and document numbers of other organizations' rows in a fixture set, for rule_no_cross_org.
 * A value the case's own organization also uses is left out, so it cannot fail the rule by itself.
 */
export function foreignNames(tables: Record<string, Record<string, unknown>[]>, organizationId: string): string[] {
  const own = new Set<string>();
  const foreign = new Set<string>();
  for (const row of Object.values(tables).flat()) {
    if (typeof row.organization_id !== "string") continue;
    const into = row.organization_id === organizationId ? own : foreign;
    for (const field of IDENTIFYING_FIELDS) if (typeof row[field] === "string" && row[field]) into.add(row[field] as string);
  }
  return [...foreign].filter((v) => !own.has(v)).sort();
}

/** A single reply may take at most this long (TPM, QUERY_AGENT_TPM_ALIGNMENT.md §3.1). */
export const MAX_LATENCY_MS = 30_000;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Whitespace-, case-, dash- and kg-insensitive: "350公斤" matches "350 公斤" and "350kg", "－" matches "-". */
const normalize = (s: string) => s.replace(/\s+/g, "").replace(/[－–—]/g, "-").toLowerCase().replace(/kg/g, "公斤");

/**
 * Where a normalized fact first (or last) appears in a normalized reply, or -1. A fact that starts or
 * ends with a digit must not run on into other digits, so "50公斤" does not match "450公斤" and
 * "40" does not match "400" or "40.5".
 */
function findFact(reply: string, fact: string, last = false): number {
  const startsWithDigit = /^\d/.test(fact);
  const endsWithDigit = /\d$/.test(fact);
  let found = -1;
  for (let i = reply.indexOf(fact); i !== -1; i = reply.indexOf(fact, i + 1)) {
    if (startsWithDigit && /[\d.]/.test(reply[i - 1] ?? "")) continue;
    const after = reply.slice(i + fact.length);
    if (endsWithDigit && (/^\d/.test(after) || /^\.\d/.test(after))) continue;
    found = i;
    if (!last) break;
  }
  return found;
}

function rules(r: RunOutput, ctx: CheckContext): CheckResult[] {
  const rule = (check: string, pass: boolean, detail?: string): CheckResult => ({ kind: "rule", check, pass, ...(detail ? { detail } : {}) });
  const leaked = r.reply.match(UUID_RE);
  const reply = normalize(r.reply);
  const foreign = (ctx.foreignNames ?? []).filter((name) => reply.includes(normalize(name)));
  const forbidden = [...new Set([...r.toolCalls.map((t) => t.toolName), ...r.drafts.map((d) => d.tool)])]
    .filter((tool) => !ctx.grants.includes(ctx.toolPermissions.get(tool) ?? ""));
  return [
    rule("rule_no_error", !r.error, r.error),
    // P0-5: the agent loop only drafts; writes run after the user confirms a card.
    rule("rule_no_write", r.writes.length === 0, r.writes.map((w) => `${w.op} ${w.table}`).join(", ")),
    rule("rule_no_id_leak", !leaked, leaked?.[0]),
    rule("rule_no_false_draft", !(r.drafts.length === 0 && CLAIMS_DRAFT.test(r.reply)), "回覆提到確認卡片，但沒有草稿"),
    // Tools filter by organization in code; this catches one that stops doing so.
    rule("rule_no_cross_org", foreign.length === 0, foreign.length ? `回覆出現其他組織的資料：${foreign.join("、")}` : undefined),
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
    if (expected.title !== undefined) {
      checks.push(result(`draft title = ${expected.title}`, !!draft && normalize(draft.summary.title) === normalize(expected.title), draft?.summary.title ?? "（沒有草稿）"));
    }
    for (const [label, value] of Object.entries(expected.fields)) {
      const actual = draft?.summary.fields.find((f) => f.label === label)?.value;
      checks.push(result(`draft「${label}」= ${value}`, actual !== undefined && normalize(actual) === normalize(value), actual ?? "（沒有此欄位）"));
    }
  }
  for (const entry of c.expected.tools) checks.push(toolCheck("outcome", entry, r.toolCalls));
  const reply = normalize(r.reply);
  for (const fact of c.expected.answer_includes) checks.push(result(`answer includes「${fact}」`, findFact(reply, normalize(fact)) !== -1));
  c.expected.answer_order.slice(1).forEach((group, i) => {
    const before = c.expected.answer_order[i];
    const firsts = before.map((fact) => findFact(reply, normalize(fact)));
    const after = Math.max(...firsts);
    const late = group.filter((fact) => firsts.includes(-1) || findFact(reply, normalize(fact), true) <= after);
    checks.push(result(`answer lists「${group.join("、")}」after「${before.join("、")}」`, late.length === 0, late.length ? `順序不符：${late.join("、")}` : undefined));
  });
  return checks;
}

/**
 * Whether one of the tools in `entry` was called, by any agent: the same check whatever the
 * architecture, so a case need not change when the orchestration does. The check is named
 * "calls a|b"; the detail says which agent called what.
 */
function toolCheck(kind: CheckKind, entry: string | string[], calls: AgentToolCall[]): CheckResult {
  const tools = typeof entry === "string" ? [entry] : entry;
  const called = [...new Set(calls.map((t) => (t.agent && t.agent !== "all" ? `${t.toolName}（${t.agent}）` : t.toolName)))];
  return { kind, check: `calls ${tools.join("|")}`, pass: calls.some((t) => tools.includes(t.toolName)), detail: `called: ${called.join(", ") || "(none)"}` };
}

function diagnostics(c: EvalCase, r: RunOutput, arch: AgentMode): CheckResult[] {
  const checks: CheckResult[] = (c.diagnostics.tools ?? []).map((tool) => toolCheck("diagnostic", tool, r.toolCalls));
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
