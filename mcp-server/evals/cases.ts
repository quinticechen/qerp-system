/**
 * Eval cases — items of the Langfuse dataset "query-agent", the source of truth
 * (docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md §2 E2, §3). Each run reads them from Langfuse
 * (optionally as of a dataset version) and saves the items it used to evals/snapshots/, so the
 * case set is tracked in git and a run can be repeated offline.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const DATASET_NAME = "query-agent";

/** Situation categories (docs/requirements/QUERY_AGENT_PHASE1.md §4.2). */
export const CATEGORIES = [
  "正常", "改寫", "沒有權限", "查無資料", "找不到指定的資料", "多筆相似", "錯誤", "超出範圍", "模棱兩可", "資訊不足", "多輪", "數字與單位",
  "安全性與防禦", "大量資料查詢", "跨流程",
] as const;

/**
 * Business APIs (docs/API.md §3) not yet wrapped as tools. A known-gap case may expect a draft from
 * one of them: it records the behaviour wanted once the tool exists.
 */
export const PLANNED_TOOLS = [
  "update_customer", "set_customer_active", "create_factory", "update_factory", "set_factory_active",
  "update_order", "cancel_order", "update_purchase_order", "cancel_purchase_order",
  "receive_inventory", "update_inventory", "update_inventory_roll", "create_shipping", "update_shipping", "cancel_shipping",
  "create_product", "update_product", "set_product_active", "add_product_color", "update_product_color", "set_product_color_active",
  "create_shelf", "update_shelf", "set_shelf_active",
] as const;
export const DOMAINS = ["customer", "factory", "product", "shelf", "order", "purchase", "receiving", "inventory", "shipping", "general"] as const;
export const SOURCES = ["real", "incident", "matrix", "generated"] as const;

const HistoryMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  /** "action" = a confirmation card, as stored by the server (memory.ts leaves it out of the model's history). */
  kind: z.enum(["text", "action"]).optional(),
  /** May carry entities, as replies saved by the server do. */
  metadata: z.unknown().optional(),
});

const Input = z.object({
  role: z.string().default("editor"),
  fixtures: z.string().default("real"),
  history: z.array(HistoryMessage).default([]),
  message: z.string().min(1),
});

const Expected = z.object({
  /** The one draft the agent should leave; card fields by label, as names (never IDs). */
  draft: z.object({ tool: z.string(), fields: z.record(z.string()).default({}) }).optional(),
  /** Explicit "no draft" — also the default when `draft` is absent. */
  no_draft: z.boolean().optional(),
  /** Facts the reply must contain (names, numbers with units). */
  answer_includes: z.array(z.string()).default([]),
  /** The §3.4 situation the LLM judge scores the reply against. */
  policy: z.string().optional(),
}).refine((e) => !(e.draft && e.no_draft), { message: "draft 與 no_draft 不可同時出現" });

const Metadata = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  category: z.enum(CATEGORIES),
  domain: z.enum(DOMAINS),
  source: z.enum(SOURCES),
  reviewed_by: z.string().optional(),
  policy_status: z.enum(["defined", "pending"]),
  diagnostics: z.object({ tools: z.array(z.string()).optional(), route: z.array(z.string()).optional() }).default({}),
  known_gap: z.string().optional(),
});

/** A dataset item as the Langfuse API returns it (only the fields a case needs). */
export interface DatasetItem {
  id: string;
  status?: string;
  input: unknown;
  expectedOutput: unknown;
  metadata: unknown;
}

export interface EvalCase {
  /** Human-readable id (metadata.id); reports and comparisons use it. */
  id: string;
  /** Langfuse item id; experiments link runs to it. */
  itemId: string;
  name: string;
  category: (typeof CATEGORIES)[number];
  domain: (typeof DOMAINS)[number];
  source: (typeof SOURCES)[number];
  reviewedBy?: string;
  policyStatus: "defined" | "pending";
  knownGap?: string;
  input: z.infer<typeof Input>;
  expected: z.infer<typeof Expected>;
  diagnostics: { tools?: string[]; route?: string[] };
}

/**
 * Why a case is left out of the metrics and gates, or null when it counts. Rules are still checked:
 * they must hold for every case.
 */
export function unscoredReason(c: Pick<EvalCase, "knownGap" | "source" | "reviewedBy">): string | null {
  if (c.knownGap) return `known gap：${c.knownGap}`;
  if (c.source === "generated" && !c.reviewedBy) return "生成的案例尚未審核";
  return null;
}

const issueText = (issues: z.ZodIssue[]) => issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("；");

/**
 * Turns dataset items into cases. Archived items are skipped; every problem is returned at once
 * (an item in the old format, an unknown tool or role, a duplicate id) so the run can stop before
 * calling any model. Without `known`, tool and role names are not checked (reading old snapshots).
 */
export function parseItems(items: DatasetItem[], known?: { tools: readonly string[]; roles: readonly string[] }): { cases: EvalCase[]; errors: string[] } {
  const cases: EvalCase[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    if (item.status && item.status !== "ACTIVE") continue;
    const input = Input.safeParse(item.input ?? {});
    const expected = Expected.safeParse(item.expectedOutput ?? {});
    const meta = Metadata.safeParse(item.metadata ?? {});
    const label = (meta.success ? meta.data.id : undefined) ?? item.id;
    const problems = [
      ...(input.success ? [] : [`input ${issueText(input.error.issues)}`]),
      ...(expected.success ? [] : [`expectedOutput ${issueText(expected.error.issues)}`]),
      ...(meta.success ? [] : [`metadata ${issueText(meta.error.issues)}`]),
    ];
    if (known && input.success && !known.roles.includes(input.data.role)) problems.push(`input.role：未知的角色「${input.data.role}」`);
    const tool = expected.success ? expected.data.draft?.tool : undefined;
    const planned = meta.success && !!meta.data.known_gap && (PLANNED_TOOLS as readonly string[]).includes(tool ?? "");
    if (known && tool && !known.tools.includes(tool) && !planned) {
      problems.push(`expectedOutput.draft.tool：未知的工具「${tool}」${(PLANNED_TOOLS as readonly string[]).includes(tool) ? "（尚未建立的工具只能用在 known_gap 案例）" : ""}`);
    }
    if (meta.success && ids.has(meta.data.id)) problems.push(`metadata.id 重複：${meta.data.id}`);
    if (problems.length || !input.success || !expected.success || !meta.success) {
      errors.push(`${label}：${problems.join("；")}`);
      continue;
    }
    ids.add(meta.data.id);
    const m = meta.data;
    cases.push({
      id: m.id, itemId: item.id, name: m.name ?? input.data.message, category: m.category, domain: m.domain, source: m.source,
      ...(m.reviewed_by ? { reviewedBy: m.reviewed_by } : {}), policyStatus: m.policy_status, ...(m.known_gap ? { knownGap: m.known_gap } : {}),
      input: input.data, expected: expected.data, diagnostics: m.diagnostics,
    });
  }
  return { cases: cases.sort((a, b) => a.id.localeCompare(b.id)), errors };
}

// ── Langfuse ──────────────────────────────────────────────────────────────────

export function langfuseConfigured(): boolean {
  return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_BASE_URL);
}

/** Langfuse Cloud allows about 100 requests a minute; a 429 is retried after the wait it names. */
const MAX_RATE_LIMIT_RETRIES = 5;

export async function langfuseApi<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T | null }> {
  const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
  let res: Response;
  let text: string;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${process.env.LANGFUSE_BASE_URL!.replace(/\/$/, "")}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    text = await res.text();
    if (res.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) break;
    const wait = Number((JSON.parse(text || "{}") as { details?: { retryAfterSeconds?: number } }).details?.retryAfterSeconds ?? 10);
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
  }
  if (!res.ok && res.status !== 404) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
}

/** All items of the dataset, as of `version` (an ISO timestamp) when given — Langfuse versions items by time. */
export async function fetchDatasetItems(version?: string): Promise<DatasetItem[]> {
  const items: DatasetItem[] = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ datasetName: DATASET_NAME, page: String(page), limit: "100", ...(version ? { version } : {}) });
    const res = await langfuseApi<{ data: DatasetItem[]; meta: { totalPages: number } }>("GET", `/api/public/dataset-items?${query}`);
    if (res.status === 404 || !res.data) throw new Error(`Langfuse 找不到 dataset「${DATASET_NAME}」`);
    items.push(...res.data.data.map(({ id, status, input, expectedOutput, metadata }) => ({ id, status, input, expectedOutput, metadata })));
    if (page >= res.data.meta.totalPages) break;
  }
  return items;
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

export interface Snapshot {
  dataset: string;
  /** The dataset version asked for; null = the latest at fetch time. */
  version: string | null;
  fetchedAt: string;
  items: DatasetItem[];
}

const itemsHash = (items: DatasetItem[]) =>
  createHash("sha256").update(JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id)))).digest("hex").slice(0, 8);

/**
 * Saves the items a run used, once per distinct content: an unchanged dataset reuses its snapshot.
 * Returns the snapshot's file name.
 */
export function saveSnapshot(dir: string, snapshot: Snapshot): string {
  mkdirSync(dir, { recursive: true });
  const hash = itemsHash(snapshot.items);
  const existing = readdirSync(dir).find((f) => f.endsWith(`-${hash}.json`));
  if (existing) return existing;
  const name = `${snapshot.fetchedAt.replace(/[-:]/g, "").slice(0, 13)}-${hash}.json`;
  writeFileSync(join(dir, name), `${JSON.stringify(snapshot, null, 2)}\n`);
  return name;
}

/** A snapshot file, or the newest one in `dir` when no file is given. */
export function loadSnapshot(dir: string, file?: string): { name: string; snapshot: Snapshot } {
  const name = file ?? (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().pop() : undefined);
  if (!name) throw new Error(`沒有快照可用（${dir}）；先連線執行一次 eval`);
  const path = name.includes("/") ? name : join(dir, name);
  return { name: path.split("/").pop()!, snapshot: JSON.parse(readFileSync(path, "utf8")) as Snapshot };
}
