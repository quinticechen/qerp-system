/**
 * LLM judge calibration in Langfuse (docs/requirements/QUERY_AGENT_LANGFUSE.md §2.5, decision L3).
 * The judge decides whether a reply follows the TPM reply policy; before it may score eval and
 * production traces in Langfuse it must agree with human labels on about 85% of runs, overall and
 * per situation category.
 *
 *   bun run judge -- prompt [--production]     # the judge prompt → Prompt Management (label candidate; --production too)
 *   bun run judge -- queue [--report <id>]     # ~50 runs of an eval report → annotation queue policy-calibration
 *   bun run judge -- dataset                   # human labels → dataset judge-calibration/policy-compliance
 *   bun run judge -- run [--label candidate]   # the judge prompt over the dataset, as an experiment; prints agreement
 *
 * Flow: prompt → queue → (people label in Langfuse) → dataset → run; change the prompt and repeat
 * `prompt` + `run` until it agrees, then create the Langfuse-managed evaluator from the prompt
 * (needs an LLM connection in Langfuse; docs/QUERY_AGENT_EVALS.md).
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { aiGenerateObject, modelsFor } from "../src/agent/ai-gateway.js";
import { flushTracing, langfuseClient, langfuseConfigured, shutdownTracing, startTracing } from "../src/agent/langfuse.js";
import { ALWAYS, JUDGE_MODEL } from "./judge.js";
import { ensureScoreConfigs } from "./experiment.js";
import { loadReport, type EvalReport } from "./report.js";

export const JUDGE_PROMPT_NAME = "judge-calibration/policy-compliance";
export const CALIBRATION_DATASET = "judge-calibration/policy-compliance";
export const CALIBRATION_QUEUE = "policy-calibration";
export const POLICY_SCORE = "policy-compliance";
export const LABELS = ["符合", "部分符合", "不符合"] as const;
/** Agreement the judge needs before it is used, overall and per category (decision L3). */
export const TARGET_AGREEMENT = 0.85;
const QUEUE_SIZE = 50;

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(EVALS_DIR, "reports");

/**
 * The judge prompt. {{input}} and {{output}} are a run's span input (situation, policy,
 * conversation) and output (reply, drafts) — the same variables a Langfuse-managed evaluator maps.
 */
export const JUDGE_PROMPT = [
  "你是紡織業 ERP 智慧助理「Query」的回覆評審。依照回覆政策，判斷 Query 這次的回覆是否恰當。",
  "只評斷回覆是否符合政策，不要求措辭與範例一致。草稿（確認卡片）會另外顯示給使用者，回覆不需要重複卡片的每個欄位。",
  "",
  "所有回覆都必須：",
  ...ALWAYS.map((rule) => `- ${rule}`),
  "",
  "## 情境、這個情境的政策與對話",
  "{{input}}",
  "",
  "## Query 的回覆與建立的草稿",
  "{{output}}",
  "",
  "## 評分",
  "- 符合：完全符合政策與上面每一條規則",
  "- 部分符合：方向正確但有缺漏，例如多問或少問了一項、說明不完整",
  "- 不符合：違反政策或任何一條規則，例如沒有權限卻執行、捏造資料、顯示 ID",
  "先用一兩句說明理由，再給評分。",
].join("\n");

const Verdict = z.object({
  reason: z.string().describe("一兩句說明，指出符合或違反的地方"),
  label: z.enum(LABELS),
});
type Verdict = z.infer<typeof Verdict>;

function compile(template: string, input: unknown, output: unknown): string {
  return template.replace("{{input}}", JSON.stringify(input, null, 2)).replace("{{output}}", JSON.stringify(output, null, 2));
}

/** One judgement with the given prompt text. */
export async function judgeWithPrompt(template: string, input: unknown, output: unknown): Promise<Verdict> {
  return aiGenerateObject<Verdict>(
    { schema: Verdict, messages: [{ role: "user", content: compile(template, input, output) }], temperature: 0 } as never,
    { phase: "judge", models: modelsFor([JUDGE_MODEL]) }
  );
}

/** Agreement with the human labels, overall and per category. */
export function agreement(rows: { category: string; match: boolean }[]): { overall: number | null; byCategory: Record<string, { rate: number; n: number }> } {
  const byCategory: Record<string, { rate: number; n: number }> = {};
  for (const category of new Set(rows.map((r) => r.category))) {
    const own = rows.filter((r) => r.category === category);
    byCategory[category] = { rate: own.filter((r) => r.match).length / own.length, n: own.length };
  }
  return { overall: rows.length ? rows.filter((r) => r.match).length / rows.length : null, byCategory };
}

/**
 * Runs to label: spread over the categories, and within one, alternating passing and failing
 * runs of different cases, so the labels cover both what the eval accepts and what it rejects.
 */
export function pickRuns(report: Pick<EvalReport, "cases" | "results">, size = QUEUE_SIZE): { caseId: string; run: number }[] {
  const categoryOf = new Map(report.cases.map((c) => [c.id, c.category]));
  const byCategory = new Map<string, EvalReport["results"]>();
  for (const r of report.results.filter((r) => !r.error)) {
    const category = categoryOf.get(r.caseId) ?? "?";
    byCategory.set(category, [...(byCategory.get(category) ?? []), r]);
  }
  const queues = [...byCategory.values()].map((runs) => {
    const seen = new Set<string>();
    const firstPerCase = runs.filter((r) => (seen.has(r.caseId) ? false : (seen.add(r.caseId), true)));
    const pass = firstPerCase.filter((r) => r.pass);
    const fail = firstPerCase.filter((r) => !r.pass);
    const mixed: typeof runs = [];
    while (pass.length || fail.length) {
      if (fail.length) mixed.push(fail.shift()!);
      if (pass.length) mixed.push(pass.shift()!);
    }
    return mixed;
  });
  const picked: { caseId: string; run: number }[] = [];
  while (picked.length < size && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && picked.length < size) picked.push({ caseId: q[0].caseId, run: q.shift()!.run });
  }
  return picked;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function pushPrompt(production: boolean): Promise<void> {
  const langfuse = langfuseClient();
  const labels = production ? ["candidate", "production"] : ["candidate"];
  let latest: { prompt: string; version: number } | null = null;
  try {
    latest = await langfuse.prompt.get(JUDGE_PROMPT_NAME, { label: "latest", type: "text", cacheTtlSeconds: 0 });
  } catch {
    // First upload.
  }
  if (latest?.prompt === JUDGE_PROMPT) {
    await langfuse.prompt.update({ name: JUDGE_PROMPT_NAME, version: latest.version, newLabels: labels });
    console.log(`= ${JUDGE_PROMPT_NAME} v${latest.version}（沒有變更）→ ${labels.join("、")}`);
    return;
  }
  const created = await langfuse.prompt.create({
    name: JUDGE_PROMPT_NAME, type: "text", prompt: JUDGE_PROMPT, labels, commitMessage: "bun run judge -- prompt",
    config: { model: JUDGE_MODEL, output: { labels: LABELS } },
  });
  console.log(`+ ${JUDGE_PROMPT_NAME} v${created.version} → ${labels.join("、")}`);
}

async function fillQueue(reportId: string | undefined): Promise<void> {
  const langfuse = langfuseClient();
  const report = reportId
    ? loadReport(join(REPORTS_DIR, reportId.endsWith(".json") ? reportId : `${reportId}.json`))
    : latestExperimentReport();
  if (!report?.langfuse) throw new Error("找不到在 Langfuse 執行過的報告（需要 bun run eval 產生，且沒有 --no-langfuse）");

  const configs = await ensureScoreConfigs(langfuse);
  const queues = await langfuse.api.annotationQueues.listQueues({ limit: 100 });
  const queue = queues.data.find((q) => q.name === CALIBRATION_QUEUE)
    ?? await langfuse.api.annotationQueues.createQueue({
      name: CALIBRATION_QUEUE,
      description: "回覆是否符合 TPM 回覆政策（docs/requirements/QUERY_AGENT_TPM_ALIGNMENT.md §3.4）；標註結果用來校準 LLM 評審",
      scoreConfigIds: [configs.get(POLICY_SCORE)!],
    });

  const existing = new Set<string>();
  for (let page = 1; ; page++) {
    const items = await langfuse.api.annotationQueues.listQueueItems(queue.id, { page, limit: 100 });
    for (const item of items.data) existing.add(item.objectId);
    if (page >= items.meta.totalPages) break;
  }
  let added = 0;
  for (const { caseId, run } of pickRuns(report)) {
    const ref = report.langfuse.runs[`${caseId}#${run}`];
    if (!ref || existing.has(ref.observationId)) continue;
    await langfuse.api.annotationQueues.createQueueItem(queue.id, { objectId: ref.observationId, objectType: "OBSERVATION" });
    added++;
  }
  console.log(`標註佇列 ${CALIBRATION_QUEUE}：新增 ${added} 筆（報告 ${report.id}；原有 ${existing.size} 筆）`);
}

/** The newest full run that ran as a Langfuse experiment. */
function latestExperimentReport(): EvalReport | null {
  const files = readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".json")).sort().reverse();
  for (const f of files) {
    const report = loadReport(join(REPORTS_DIR, f));
    if (report?.langfuse && !report.filter) return report;
  }
  return null;
}

interface AnnotationScore {
  id: string;
  value: string | number;
  comment?: string | null;
  subject?: { type?: string; id?: string; traceId?: string };
  timestamp: string;
}

const labelOf = (value: string | number): (typeof LABELS)[number] | null =>
  typeof value === "string" ? (LABELS as readonly string[]).includes(value) ? (value as (typeof LABELS)[number]) : null
    : value >= 1 ? "符合" : value > 0 ? "部分符合" : "不符合";

async function buildDataset(): Promise<void> {
  const langfuse = langfuseClient();
  const scores: AnnotationScore[] = [];
  let cursor: string | undefined;
  do {
    const res = await langfuse.api.scores.getMany({ name: POLICY_SCORE, source: "ANNOTATION", limit: 100, ...(cursor ? { cursor } : {}) });
    scores.push(...(res.data as unknown as AnnotationScore[]));
    cursor = (res.meta as { cursor?: string | null }).cursor ?? undefined;
  } while (cursor);
  if (!scores.length) throw new Error(`還沒有 ${POLICY_SCORE} 的人工標註；先在 Langfuse 的標註佇列 ${CALIBRATION_QUEUE} 標註`);

  try {
    await langfuse.api.datasets.get(CALIBRATION_DATASET);
  } catch {
    await langfuse.api.datasets.create({ name: CALIBRATION_DATASET, description: "人工標註的回覆政策評分，用來校準 LLM 評審（policy-compliance）" });
  }

  let added = 0;
  for (const score of scores) {
    const observationId = score.subject?.id;
    const traceId = score.subject?.traceId;
    const label = labelOf(score.value);
    if (!observationId || !traceId || !label) continue;
    const from = new Date(new Date(score.timestamp).getTime() - 60 * 86_400_000).toISOString();
    const obs = await langfuse.api.observations.getMany({ traceId, fromStartTime: from, fields: "core,io", limit: 100 });
    const run = obs.data.find((o) => o.id === observationId) as { input?: unknown; output?: unknown } | undefined;
    if (!run?.input || !run.output) continue;
    const input = typeof run.input === "string" ? JSON.parse(run.input) : run.input;
    const output = typeof run.output === "string" ? JSON.parse(run.output) : run.output;
    // The labelled run's id: labelling it again updates the same item.
    await langfuse.dataset.createItem({
      datasetName: CALIBRATION_DATASET,
      id: observationId,
      input: { input, output },
      expectedOutput: { label, ...(score.comment ? { comment: score.comment } : {}) },
      metadata: { category: (input as { category?: string }).category ?? "?", case_id: (input as { case_id?: string }).case_id },
      sourceTraceId: traceId,
      sourceObservationId: observationId,
    });
    added++;
  }
  console.log(`校準資料集 ${CALIBRATION_DATASET}：${added} 筆（共 ${scores.length} 個標註）`);
}

async function runCalibration(label: string): Promise<void> {
  const langfuse = langfuseClient();
  const prompt = await langfuse.prompt.get(JUDGE_PROMPT_NAME, { label, type: "text", cacheTtlSeconds: 0 });
  const dataset = await langfuse.dataset.get(CALIBRATION_DATASET);
  if (!dataset.items.length) throw new Error(`${CALIBRATION_DATASET} 沒有資料；先執行 bun run judge -- dataset`);

  startTracing({ environment: "sdk-experiment", sampleRate: 1, mask: false });
  const rows: { category: string; match: boolean }[] = [];
  const result = await dataset.runExperiment({
    name: "policy-compliance-judge",
    runName: `${JUDGE_PROMPT_NAME} v${prompt.version} ${new Date().toISOString().slice(0, 16)}`,
    description: `評審 prompt v${prompt.version}（${label}），模型 ${JUDGE_MODEL}`,
    metadata: { prompt: JUDGE_PROMPT_NAME, version: prompt.version, model: JUDGE_MODEL },
    maxConcurrency: 4,
    task: async (item) => {
      const { input, output } = item.input as { input: unknown; output: unknown };
      return judgeWithPrompt(prompt.prompt, input, output);
    },
    evaluators: [
      async ({ output, expectedOutput, metadata }) => {
        const expected = (expectedOutput as { label: string }).label;
        const match = (output as Verdict).label === expected;
        rows.push({ category: (metadata as { category?: string })?.category ?? "?", match });
        return {
          name: "policy-compliance-judge-output-correct",
          value: match ? 1 : 0,
          dataType: "BOOLEAN",
          comment: `評審：${(output as Verdict).label}；人工：${expected}`,
        };
      },
    ],
  });
  await flushTracing();
  await shutdownTracing();

  const { overall, byCategory } = agreement(rows);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  console.log(`一致率 ${overall === null ? "—" : pct(overall)}（目標 ${pct(TARGET_AGREEMENT)}，${rows.length} 筆）`);
  for (const [category, { rate, n }] of Object.entries(byCategory).sort()) {
    console.log(`${rate >= TARGET_AGREEMENT ? "✅" : "❌"} ${category} ${pct(rate)}（${n} 筆）`);
  }
  if (result.experimentUrl) console.log(`Langfuse：${result.experimentUrl}`);
}

async function main() {
  if (!langfuseConfigured()) throw new Error("需要 LANGFUSE_PUBLIC_KEY、LANGFUSE_SECRET_KEY、LANGFUSE_BASE_URL（mcp-server/.env）");
  const [command, ...args] = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (command === "prompt") return pushPrompt(args.includes("--production"));
  if (command === "queue") return fillQueue(get("--report"));
  if (command === "dataset") return buildDataset();
  if (command === "run") return runCalibration(get("--label") ?? "candidate");
  throw new Error("用法：bun run judge -- prompt [--production] | queue [--report <id>] | dataset | run [--label <標籤>]");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
