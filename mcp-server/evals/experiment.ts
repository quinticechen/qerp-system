/**
 * The eval as a Langfuse experiment (docs/requirements/QUERY_AGENT_LANGFUSE.md §2.3), through the
 * SDK's experiment runner: one dataset run per eval, one trace per case holding its runs (each with
 * the AI SDK's generations and tool calls), item scores per case and run scores for the gates.
 * Every score carries a score config, created here when the project lacks it.
 */

import type { LangfuseClient } from "@langfuse/client";
import type { CreateScoreConfigRequest } from "@langfuse/core";
import { startActiveObservation } from "@langfuse/tracing";
import { kindPassed } from "./checks.js";
import type { EvalCase } from "./cases.js";
import { POLICIES } from "./judge.js";
import { costOf, type CaseInfo, type CaseStatus, type GateResult, type LangfuseRunRef, type RunResult } from "./report.js";

/** Score configs, named after what they measure (Langfuse: one config per score name). */
export const SCORE_CONFIGS: CreateScoreConfigRequest[] = [
  { name: "pass_rate", dataType: "NUMERIC", minValue: 0, maxValue: 1, description: "這個案例通過的執行比例（規則與結果都通過）" },
  { name: "rules", dataType: "NUMERIC", minValue: 0, maxValue: 1, description: "不可違反的規則（不寫入、不顯示 ID、不謊稱草稿、權限、30 秒內）都通過的執行比例" },
  { name: "outcome", dataType: "NUMERIC", minValue: 0, maxValue: 1, description: "結果（草稿與回覆中的事實）符合預期的執行比例；政策待定的案例沒有這個分數" },
  { name: "passed", dataType: "BOOLEAN", description: "案例通過：通過的執行比例達到門檻（預設 3 次中 2 次）" },
  { name: "latency_ms", dataType: "NUMERIC", minValue: 0, description: "這個案例每次執行的平均延遲（毫秒）" },
  { name: "cost_usd", dataType: "NUMERIC", minValue: 0, description: "這個案例每次執行的平均模型花費（美元，不含 LLM 評審）" },
  { name: "policy_judge", dataType: "NUMERIC", minValue: 0, maxValue: 1, description: "程式內 LLM 評審的平均分數（校準前只記錄，不計入門檻）" },
  { name: "task_completion", dataType: "NUMERIC", minValue: 0, maxValue: 1, description: "整次執行：計分案例的任務完成率" },
  { name: "gates_passed", dataType: "BOOLEAN", description: "整次執行：所有門檻都通過" },
  {
    name: "policy-compliance", dataType: "CATEGORICAL",
    categories: [{ label: "符合", value: 1 }, { label: "部分符合", value: 0.5 }, { label: "不符合", value: 0 }],
    description: "回覆是否符合 TPM 回覆政策（人工標註與 Langfuse LLM 評審）",
  },
  { name: "user-feedback", dataType: "BOOLEAN", description: "使用者對回覆按讚（1）或倒讚（0）" },
];

/** Creates the missing score configs; returns each config's id by name. */
export async function ensureScoreConfigs(langfuse: LangfuseClient): Promise<Map<string, string>> {
  const existing = new Map<string, string>();
  for (let page = 1; ; page++) {
    const res = await langfuse.api.scoreConfigs.get({ page, limit: 100 });
    for (const c of res.data) if (!c.isArchived) existing.set(c.name, c.id);
    if (page >= res.meta.totalPages) break;
  }
  for (const config of SCORE_CONFIGS) {
    if (existing.has(config.name)) continue;
    const created = await langfuse.api.scoreConfigs.create(config);
    existing.set(created.name, created.id);
  }
  return existing;
}

export type RunInSpan = (run: number, fn: () => Promise<RunResult>) => Promise<RunResult>;

/**
 * What a run's span shows: the situation and conversation as input, the reply and drafts as
 * output — what the policy-compliance annotators and judge read (evals/judge-calibration.ts).
 */
export function runSpanInput(c: EvalCase) {
  const policy = c.expected.policy ?? c.category;
  return {
    case_id: c.id,
    category: c.category,
    policy: POLICIES[policy] ?? POLICIES[c.category] ?? POLICIES.正常,
    history: c.input.history.filter((m) => m.kind !== "action").map((m) => ({ role: m.role, content: m.content })),
    message: c.input.message,
  };
}

export function runSpanOutput(r: Pick<RunResult, "reply" | "drafts">) {
  return { reply: r.reply, drafts: r.drafts.map((d) => d.summary) };
}

/** What a case's trace shows as its output; the full runs stay in the local report. */
export interface CaseOutput {
  caseId: string;
  passed: string;
  replies: string[];
  drafts: unknown[][];
}

export interface ExperimentParams {
  langfuse: LangfuseClient;
  /** Report id: the dataset run's name, so the run and the local report match. */
  runName: string;
  description: string;
  metadata: Record<string, unknown>;
  datasetId: string;
  datasetVersion?: string;
  cases: EvalCase[];
  infos: Map<string, CaseInfo>;
  configIds: Map<string, string>;
  concurrency: number;
  /** Runs a case `runs` times; called inside the case's trace. */
  runCase: (c: EvalCase, runInSpan: RunInSpan) => Promise<RunResult[]>;
  /** The case's status from its runs (report.ts caseStatuses). */
  status: (caseId: string, runs: RunResult[]) => CaseStatus | undefined;
  /** The gates over every result, for the run scores. */
  gates: (results: RunResult[]) => { taskCompletion: number | null; gates: GateResult[] };
}

const share = (runs: RunResult[], pass: (r: RunResult) => boolean | null): number | null => {
  const scored = runs.filter((r) => pass(r) !== null);
  return scored.length ? scored.filter((r) => pass(r)).length / scored.length : null;
};

/**
 * Mean model cost of one run, or null when no run reported a cost. The trace's own cost and
 * latency add up all of a case's runs, so these per-run means are what compares across evals
 * that ran each case a different number of times.
 */
export function meanCost(runs: RunResult[]): number | null {
  const costs = runs.map(costOf).filter((c): c is number => c !== null);
  return costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
}

/** Runs every case through the SDK experiment runner; returns the results and the experiment link. */
export async function runExperiment(p: ExperimentParams): Promise<{ results: RunResult[]; url?: string; runs: Record<string, LangfuseRunRef> }> {
  const byCase = new Map<string, RunResult[]>();
  const runRefs: Record<string, LangfuseRunRef> = {};
  const byItem = new Map(p.cases.map((c) => [c.itemId, c]));
  const score = (name: string, value: number | null, comment?: string) => {
    if (value === null) return [];
    const dataType = SCORE_CONFIGS.find((c) => c.name === name)?.dataType ?? "NUMERIC";
    const configId = p.configIds.get(name);
    return [{ name, value, dataType, ...(comment ? { comment } : {}), ...(configId ? { configId } : {}) }];
  };

  const result = await p.langfuse.experiment.run({
    name: "query-agent",
    runName: p.runName,
    description: p.description,
    metadata: p.metadata,
    maxConcurrency: p.concurrency,
    ...(p.datasetVersion ? { datasetVersion: p.datasetVersion } : {}),
    // Items as the dataset holds them, so each trace links to its dataset item.
    data: p.cases.map((c) => ({
      id: c.itemId,
      datasetId: p.datasetId,
      input: c.input,
      expectedOutput: c.expected,
      metadata: { id: c.id, category: c.category, domain: c.domain },
    })) as never,
    task: async (item) => {
      const c = byItem.get((item as { id: string }).id)!;
      const runInSpan: RunInSpan = (run, fn) =>
        startActiveObservation(`run ${run}`, async (span) => {
          runRefs[`${c.id}#${run}`] = { traceId: span.traceId, observationId: span.id };
          const r = await fn();
          span.update({ input: runSpanInput(c), output: runSpanOutput(r), ...(r.error ? { level: "ERROR" as const, statusMessage: r.error } : {}) });
          return r;
        }, { asType: "chain" });
      const runs = await p.runCase(c, runInSpan);
      byCase.set(c.id, runs);
      const output: CaseOutput = {
        caseId: c.id,
        passed: `${runs.filter((r) => r.pass).length}/${runs.length}`,
        replies: runs.map((r) => r.reply),
        drafts: runs.map((r) => r.drafts.map((d) => d.summary)),
      };
      return output;
    },
    evaluators: [
      async ({ output }) => {
        const caseId = (output as CaseOutput).caseId;
        const runs = byCase.get(caseId) ?? [];
        if (!runs.length) return [];
        const failures = runs.filter((r) => !r.pass)
          .map((r) => `run ${r.run}：${r.checks.filter((ch) => ch.kind !== "diagnostic" && !ch.pass).map((ch) => ch.check).join("；")}`)
          .join("\n");
        const judged = runs.filter((r) => r.judge);
        const status = p.status(caseId, runs);
        return [
          ...score("pass_rate", share(runs, (r) => r.pass), failures || undefined),
          ...score("rules", share(runs, (r) => kindPassed(r.checks, "rule"))),
          ...score("outcome", share(runs, (r) => kindPassed(r.checks, "outcome"))),
          ...score("latency_ms", Math.round(runs.reduce((s, r) => s + r.latencyMs, 0) / runs.length)),
          ...score("cost_usd", meanCost(runs)),
          ...(judged.length
            ? score("policy_judge", judged.reduce((s, r) => s + r.judge!.score, 0) / judged.length, judged.map((r) => `run ${r.run}：${r.judge!.reason}`).join("\n"))
            : []),
          ...(p.infos.get(caseId)?.unscored || !status ? [] : score("passed", status === "✅" ? 1 : 0)),
        ];
      },
    ],
    runEvaluators: [
      async () => {
        const { taskCompletion, gates } = p.gates([...byCase.values()].flat());
        const failed = gates.filter((g) => !g.pass).map((g) => g.label);
        return [
          ...score("task_completion", taskCompletion),
          ...score("gates_passed", failed.length ? 0 : 1, failed.length ? `未通過：${failed.join("、")}` : undefined),
        ];
      },
    ],
  });

  // Every case ran in the experiment; a case the runner skipped (its task threw) has no results.
  const results = p.cases.flatMap((c) => byCase.get(c.id) ?? []);
  return { results, url: result.experimentUrl, runs: runRefs };
}
