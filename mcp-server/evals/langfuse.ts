/**
 * Langfuse upload — sends an eval report to Langfuse as an experiment on the "query-agent" dataset:
 * one trace per case (run → model attempt → provider call as a generation, plus tool calls) and a
 * pass_rate / passed score per case. Talks to the public REST API and the OTLP/HTTP endpoint
 * directly, without the SDK. IDs derive from the report and case IDs, so uploading the same report
 * again updates it instead of duplicating it. See docs/QUERY_AGENT_EVALS.md.
 *
 *   bun run eval:upload -- evals/reports/<id>.json [...]   # e.g. reports from before Langfuse
 *   bun run eval:upload -- --all
 *
 * Needs LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL in .env.
 */

import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { caseStatuses, loadCases, loadReport, type CaseInfo, type EvalCase, type EvalReport, type RunResult } from "./report.js";

export const DATASET_NAME = "query-agent";
/** What the Langfuse SDK's experiment runner uses; keeps eval traces apart from production ones. */
const ENVIRONMENT = "sdk-experiment";

export function langfuseConfigured(): boolean {
  return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_BASE_URL);
}

async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T | null }> {
  const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
  const res = await fetch(`${process.env.LANGFUSE_BASE_URL!.replace(/\/$/, "")}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok && res.status !== 404) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
}

// ── OTLP spans ────────────────────────────────────────────────────────────────

type AttrValue = { stringValue: string } | { doubleValue: number } | { boolValue: boolean } | { arrayValue: { values: { stringValue: string }[] } };

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 1;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: { key: string; value: AttrValue }[];
  status: { code: 1 | 2; message?: string };
}

/** Deterministic hex ID: re-uploading a report overwrites the same traces and scores. */
export const hexId = (seed: string, length: 16 | 32) => createHash("sha256").update(seed).digest("hex").slice(0, length);

function attributes(values: Record<string, string | number | boolean | string[] | undefined>): OtlpSpan["attributes"] {
  return Object.entries(values).flatMap(([key, v]): OtlpSpan["attributes"] => {
    if (v === undefined) return [];
    if (Array.isArray(v)) return [{ key, value: { arrayValue: { values: v.map((s) => ({ stringValue: s })) } } }];
    if (typeof v === "number") return [{ key, value: { doubleValue: v } }];
    if (typeof v === "boolean") return [{ key, value: { boolValue: v } }];
    return [{ key, value: { stringValue: v } }];
  });
}

const nanos = (ms: number) => (BigInt(Math.round(ms)) * 1_000_000n).toString();
const json = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v));

/** Run timing; reports from before 2026-10-09 have none, so their runs are laid out back to back. */
function runWindows(report: EvalReport, runs: RunResult[]): { start: number; end: number }[] {
  let cursor = Date.parse(report.createdAt);
  return runs.map((r) => {
    const start = r.startedAt ?? cursor;
    cursor = start + r.latencyMs;
    return { start, end: start + r.latencyMs };
  });
}

/** All spans of one case's trace. */
export function buildCaseSpans(report: EvalReport, info: CaseInfo, evalCase: EvalCase | undefined, datasetId: string): OtlpSpan[] {
  const runs = report.results.filter((r) => r.caseId === info.id).sort((a, b) => a.run - b.run);
  const windows = runWindows(report, runs);
  const traceId = hexId(`${report.id}:${info.id}`, 32);
  const rootId = hexId(`${traceId}:root`, 16);
  const status = caseStatuses(report).get(info.id);
  const { arch, models, hashes, git } = report.manifest;

  const experiment = attributes({
    "langfuse.environment": ENVIRONMENT,
    "langfuse.experiment.id": report.id,
    "langfuse.experiment.name": report.id,
    "langfuse.experiment.description": report.label,
    "langfuse.experiment.metadata": json({ label: report.label, arch, models, hashes, git }),
    "langfuse.experiment.dataset.id": datasetId,
    "langfuse.experiment.item.id": info.id,
    "langfuse.experiment.item.root_observation_id": rootId,
  });
  const span = (spanId: string, parentSpanId: string | undefined, name: string, start: number, end: number,
    values: Record<string, string | number | boolean | string[] | undefined>, error?: string): OtlpSpan => ({
    traceId, spanId, ...(parentSpanId ? { parentSpanId } : {}), name, kind: 1,
    startTimeUnixNano: nanos(start), endTimeUnixNano: nanos(Math.max(end, start + 1)),
    attributes: [...experiment, ...attributes(values)],
    status: error ? { code: 2, message: error } : { code: 1 },
  });

  const spans: OtlpSpan[] = [
    span(rootId, undefined, `eval:${info.id}`, Math.min(...windows.map((w) => w.start)), Math.max(...windows.map((w) => w.end)), {
      "langfuse.trace.name": `eval:${info.id}`,
      "langfuse.trace.tags": [info.category, arch, ...(info.known_gap ? ["known_gap"] : [])],
      "langfuse.trace.metadata.case_name": info.name,
      "langfuse.trace.metadata.category": info.category,
      "langfuse.observation.input": json({ message: evalCase?.message, history: evalCase?.history }),
      "langfuse.observation.output": json({ status, passed: `${runs.filter((r) => r.pass).length}/${runs.length}`, replies: runs.map((r) => r.reply) }),
      "langfuse.experiment.item.expected_output": json(evalCase?.expect),
      "langfuse.observation.level": status === "❌" ? "WARNING" : "DEFAULT",
    }),
  ];

  runs.forEach((r, i) => {
    const runId = hexId(`${traceId}:run:${r.run}`, 16);
    const failed = r.checks.filter((c) => !c.pass).map((c) => c.check).join("；");
    spans.push(span(runId, rootId, `run ${r.run}`, windows[i].start, windows[i].end, {
      "langfuse.observation.output": json(r.reply),
      "langfuse.observation.metadata.route": r.route?.agents.join("+"),
      "langfuse.observation.level": r.error ? "ERROR" : r.pass ? "DEFAULT" : "WARNING",
      "langfuse.observation.status_message": failed || undefined,
    }, r.error));

    if (r.attempts) {
      r.attempts.forEach((a, j) => {
        const attemptId = hexId(`${runId}:attempt:${j}`, 16);
        spans.push(span(attemptId, runId, a.phase, a.startedAt, a.startedAt + a.durationMs, {
          "langfuse.observation.type": a.phase.startsWith("agent:") ? "agent" : "chain",
          "langfuse.observation.metadata.model": a.modelId,
          "langfuse.observation.level": a.error ? "ERROR" : "DEFAULT",
          "langfuse.observation.status_message": a.error,
        }));
        a.calls.forEach((call, k) => {
          spans.push(span(hexId(`${attemptId}:call:${k}`, 16), attemptId, `${a.phase} · ${a.modelId}`, call.startedAt, call.startedAt + call.durationMs, {
            "langfuse.observation.type": "generation",
            "langfuse.observation.model.name": a.modelId,
            "langfuse.observation.usage_details": json({ input: call.inputTokens, output: call.outputTokens }),
            "langfuse.observation.cost_details": call.costUsd === null ? undefined : json({ total: call.costUsd }),
            "langfuse.observation.metadata.provider": call.provider,
            "langfuse.observation.input": json(call.input),
            "langfuse.observation.output": json(call.output),
          }));
        });
      });
    } else if (r.tokens) {
      // Before attempts were recorded: one generation with the run's sub-agent tokens.
      spans.push(span(hexId(`${runId}:legacy`, 16), runId, "agents", windows[i].start, windows[i].end, {
        "langfuse.observation.type": "generation",
        "langfuse.observation.model.name": Object.values(models)[0]?.[0],
        "langfuse.observation.usage_details": json({ total: r.tokens }),
      }));
    }

    const steps = r.steps ?? [{ agent: "", at: windows[i].start, toolCalls: r.toolCalls }];
    steps.forEach((step, j) => step.toolCalls.forEach((call, k) => {
      spans.push(span(hexId(`${runId}:tool:${j}:${k}`, 16), runId, call.toolName, step.at, step.at + 1, {
        "langfuse.observation.type": "tool",
        "langfuse.observation.input": json(call.args),
        "langfuse.observation.metadata.agent": step.agent || undefined,
      }));
    }));
  });
  return spans;
}

/** pass_rate (all cases) and passed (scored cases) on each case's trace. */
export function buildScores(report: EvalReport): object[] {
  const statuses = caseStatuses(report);
  return report.cases.flatMap((info) => {
    const runs = report.results.filter((r) => r.caseId === info.id);
    if (!runs.length) return [];
    const traceId = hexId(`${report.id}:${info.id}`, 32);
    const observationId = hexId(`${traceId}:root`, 16);
    const failures = runs.filter((r) => !r.pass)
      .map((r) => `run ${r.run}：${r.checks.filter((c) => !c.pass).map((c) => c.check).join("；")}`).join("\n");
    const common = { traceId, observationId, environment: ENVIRONMENT };
    const scores: object[] = [{
      ...common, id: hexId(`${traceId}:pass_rate`, 32), name: "pass_rate", dataType: "NUMERIC",
      value: runs.filter((r) => r.pass).length / runs.length, ...(failures ? { comment: failures } : {}),
    }];
    if (!info.known_gap) {
      scores.push({ ...common, id: hexId(`${traceId}:passed`, 32), name: "passed", dataType: "BOOLEAN", value: statuses.get(info.id) === "✅" ? 1 : 0 });
    }
    return scores;
  });
}

// ── Upload ────────────────────────────────────────────────────────────────────

interface Dataset {
  id: string;
  projectId: string;
}

async function ensureDataset(): Promise<Dataset> {
  const found = await api<Dataset>("GET", `/api/public/v2/datasets/${DATASET_NAME}`);
  if (found.status !== 404 && found.data) return found.data;
  const created = await api<Dataset>("POST", "/api/public/v2/datasets", {
    name: DATASET_NAME,
    description: "Query Agent eval 案例（mcp-server/evals/cases），由 bun run eval 同步",
  });
  return created.data!;
}

/** Returns the link to the dataset, whose experiments tab lists every uploaded run. */
export async function uploadReport(report: EvalReport, currentCases: EvalCase[]): Promise<string> {
  const dataset = await ensureDataset();
  const byId = new Map(currentCases.map((c) => [c.id, c]));

  // Dataset items mirror the case files; a case deleted since an old report keeps its last version.
  for (const info of report.cases) {
    const c = byId.get(info.id);
    if (!c) continue;
    await api("POST", "/api/public/dataset-items", {
      datasetName: DATASET_NAME,
      id: c.id,
      input: { message: c.message, history: c.history, role: c.role ?? "owner", fixtures: c.fixtures ?? "basic" },
      expectedOutput: c.expect,
      metadata: { name: c.name, category: c.category, note: c.note, known_gap: c.known_gap },
    });
  }

  for (const info of report.cases) {
    const spans = buildCaseSpans(report, info, byId.get(info.id), dataset.id);
    await api("POST", "/api/public/otel/v1/traces", {
      resourceSpans: [{
        resource: { attributes: attributes({ "service.name": "query-agent-eval" }) },
        scopeSpans: [{ scope: { name: "weave-flow-evals" }, spans }],
      }],
    }, { "x-langfuse-ingestion-version": "4" });
  }

  await api("POST", "/api/public/scores", buildScores(report));
  return `${process.env.LANGFUSE_BASE_URL!.replace(/\/$/, "")}/project/${dataset.projectId}/datasets/${dataset.id}`;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  if (!langfuseConfigured()) throw new Error("LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL are required (see .env)");
  const evalsDir = dirname(fileURLToPath(import.meta.url));
  const reportsDir = join(evalsDir, "reports");
  const args = process.argv.slice(2);
  const paths = args.includes("--all")
    ? readdirSync(reportsDir).filter((f) => f.endsWith(".json")).sort().map((f) => join(reportsDir, f))
    : args.map((p) => resolve(p));
  if (!paths.length) throw new Error("Give report files, or --all");

  const cases = loadCases(join(evalsDir, "cases"));
  let url = "";
  for (const path of paths) {
    const report = loadReport(path, cases);
    url = await uploadReport(report, cases);
    console.log(`✓ ${report.id}`);
  }
  console.log(`Langfuse：${url}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
