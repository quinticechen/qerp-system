/**
 * Database consistency check (docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md §5.3, E7): before an
 * eval, confirm that the fake data and the simulated APIs still match the real database, so the
 * eval does not pass against a schema that no longer exists.
 *
 * It compares structure and rules, not content — the fixtures are invented records. Everything
 * goes through PostgREST as the test account (VERIFY_EMAIL / VERIFY_PASSWORD, root .env) and
 * reads or runs nothing: `limit=0` queries reject unknown columns (42703), relations (PGRST200)
 * and enum values (22P02), and calling a function with a parameter it does not have fails before
 * it runs (PGRST202), with a hint naming its real parameters. PostgREST's OpenAPI description
 * would be simpler but needs the service_role key.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zodSchema } from "ai";
import { getAllTools } from "../src/tools/index.js";
import type { FakeAccess, Tables } from "./fake-supabase.js";

export interface DbIssue {
  check: string;
  detail: string;
}

// ── Pure helpers (tests/eval-db-check.test.ts) ────────────────────────────────

/** `supabase.from("orders").select("id, customers(name)")` calls with literal names in tool sources. */
export function extractToolSelects(source: string): { table: string; select: string }[] {
  const re = /\.from\("([a-z_]+)"\)\s*\.select\("([^"]+)"\)/g;
  return [...source.matchAll(re)].map((m) => ({ table: m[1], select: m[2].replace(/\s+/g, "") }));
}

/**
 * Scalar columns of each fixture table, and keys holding objects in any row (an embedded relation
 * or a json column) — a relation that is null in some rows is still a relation.
 */
export function fixtureShape(tables: Tables): { table: string; columns: string[]; nested: string[] }[] {
  return Object.entries(tables).filter(([, rows]) => rows.length).map(([table, rows]) => {
    const keys = new Set(rows.flatMap((row) => Object.keys(row)));
    const nested = new Set(rows.flatMap((row) => Object.entries(row).filter(([, v]) => v !== null && typeof v === "object").map(([k]) => k)));
    return { table, columns: [...keys].filter((k) => !nested.has(k)).sort(), nested: [...nested].sort() };
  });
}

/** Columns holding enum-like values that a fixture or a tool may get wrong. */
const STATUS_COLUMNS = ["status", "payment_status", "shipping_status", "product_status", "quality"];

/** Distinct values of status columns in the fixtures: table → column → values. */
export function fixtureStatuses(tables: Tables): { table: string; column: string; value: string }[] {
  const out = new Map<string, { table: string; column: string; value: string }>();
  for (const [table, rows] of Object.entries(tables)) for (const row of rows) for (const column of STATUS_COLUMNS) {
    const value = row[column];
    if (typeof value === "string") out.set(`${table}.${column}=${value}`, { table, column, value });
  }
  return [...out.values()];
}

/** Tool inputs whose enum values filter or write a table column. */
const TOOL_ENUM_COLUMNS: { tool: string; table: string; fields: string[] }[] = [
  { tool: "list_orders", table: "orders", fields: ["status", "payment_status"] },
  { tool: "update_order_status", table: "orders", fields: ["status", "payment_status"] },
  { tool: "list_products", table: "products_new", fields: ["status"] },
  { tool: "list_purchase_orders", table: "purchase_orders", fields: ["status"] },
];

export function toolEnumValues(): { table: string; column: string; value: string; tool: string }[] {
  return TOOL_ENUM_COLUMNS.flatMap(({ tool, table, fields }) => {
    const def = getAllTools().find((t) => t.name === tool);
    if (!def) return [];
    const props = (zodSchema(def.input).jsonSchema as { properties?: Record<string, { enum?: string[] }> }).properties ?? {};
    return fields.flatMap((column) => (props[column]?.enum ?? []).map((value) => ({ table, column, value, tool })));
  });
}

/** "…call the function public.create_order(p_customer_id, p_dry_run, …)" → the parameter names. */
export function parseSignatureHint(hint: string | null | undefined): string[] | null {
  const m = hint?.match(/function [\w.]+\(([^)]*)\)/);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean).sort() : null;
}

/** Error codes documented in docs/API.md §3 (backticked lowercase words in the error tables). */
export function apiDocCodes(markdown: string): Set<string> {
  const rows = markdown.split("\n").filter((l) => /^\|\s*`?\d|^\|\s*`[0-9A-Z]{5}`/.test(l));
  return new Set(rows.flatMap((l) => [...l.matchAll(/`([a-z]+(?:_[a-z]+)*)`/g)].map((m) => m[1])));
}

/** HINT codes the simulated APIs raise: invalid("x", …), notFound("x", …), err("code", "x", …). */
export function fakeApiCodes(source: string): string[] {
  const re = /(?:invalid|notFound)\(\s*"([a-z_]+)"|err\(\s*"[0-9A-Z]+",\s*"([a-z_]+)"/g;
  return [...new Set([...source.matchAll(re)].map((m) => m[1] ?? m[2]))].sort();
}

/** roles.json against role_permissions rows; the owner holds the admin's keys (RBAC R1). */
export function compareRoles(roles: Record<string, FakeAccess>, rows: { role: string; permission_key: string }[]): DbIssue[] {
  const issues: DbIssue[] = [];
  const db: Record<string, string[]> = {};
  for (const r of rows) (db[r.role] ??= []).push(r.permission_key);
  const expected = (role: string) => (role === "owner" ? db.admin : db[role]) ?? [];
  for (const [role, access] of Object.entries(roles)) {
    if (role.startsWith("_")) continue;
    if (role !== "owner" && !db[role]) { issues.push({ check: "角色權限", detail: `roles.json 的角色「${role}」不在 role_permissions` }); continue; }
    const want = new Set(expected(role));
    const have = new Set(access.grants);
    const missing = [...want].filter((k) => !have.has(k)).sort();
    const extra = [...have].filter((k) => !want.has(k)).sort();
    if (missing.length) issues.push({ check: "角色權限", detail: `${role} 缺少：${missing.join(", ")}` });
    if (extra.length) issues.push({ check: "角色權限", detail: `${role} 多出：${extra.join(", ")}` });
  }
  for (const role of Object.keys(db)) if (!(role in roles)) issues.push({ check: "角色權限", detail: `role_permissions 的角色「${role}」不在 roles.json` });
  return issues;
}

// ── Network ───────────────────────────────────────────────────────────────────

/** VERIFY_EMAIL / VERIFY_PASSWORD live in the project's root .env (shared with verify-query-ui.py). */
function testAccount(rootEnvPath: string): { email: string; password: string } | null {
  let email = process.env.VERIFY_EMAIL;
  let password = process.env.VERIFY_PASSWORD;
  if (!email || !password) {
    try {
      for (const line of readFileSync(rootEnvPath, "utf8").split("\n")) {
        const m = line.match(/^\s*(VERIFY_EMAIL|VERIFY_PASSWORD)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        const value = m[2].replace(/^["']|["']$/g, "");
        if (m[1] === "VERIFY_EMAIL") email ??= value; else password ??= value;
      }
    } catch { /* no root .env */ }
  }
  return email && password ? { email, password } : null;
}

interface PgError { code?: string; message?: string; hint?: string | null }

class Rest {
  constructor(private url: string, private anonKey: string, private token: string) {}

  static async signIn(url: string, anonKey: string, account: { email: string; password: string }): Promise<Rest> {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify(account),
    });
    const body = (await res.json()) as { access_token?: string; error_description?: string; msg?: string };
    if (!body.access_token) throw new Error(`測試帳號登入失敗：${body.error_description ?? body.msg ?? res.status}`);
    return new Rest(url, anonKey, body.access_token);
  }

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.anonKey, Authorization: `Bearer ${this.token}`, ...extra };
  }

  async get(path: string): Promise<{ ok: boolean; data: unknown; error?: PgError }> {
    const res = await fetch(`${this.url}/rest/v1/${path}`, { headers: this.headers() });
    const data = await res.json().catch(() => null);
    return res.ok ? { ok: true, data } : { ok: false, data: null, error: data as PgError };
  }

  async rpc(name: string, body: unknown): Promise<{ status: number; error?: PgError }> {
    const res = await fetch(`${this.url}/rest/v1/rpc/${name}`, { method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as PgError | null;
    return { status: res.status, ...(res.ok ? {} : { error: data ?? {} }) };
  }
}

const describe = (e?: PgError) => [e?.code, e?.message, e?.hint].filter(Boolean).join("；");

export interface DbCheckInput {
  fixtures: Record<string, Tables>;
  roles: Record<string, FakeAccess>;
  /** Simulated API → its parameter names (fake-api.ts). */
  apiParams: Record<string, string[]>;
  toolsDir: string;
  fakeApiSource: string;
  apiDoc: string;
  rootEnvPath: string;
}

export async function checkDatabase(input: DbCheckInput): Promise<DbIssue[]> {
  const issues: DbIssue[] = [];

  // Error codes: local files only.
  const documented = apiDocCodes(input.apiDoc);
  for (const code of fakeApiCodes(input.fakeApiSource)) {
    if (!documented.has(code)) issues.push({ check: "錯誤代碼", detail: `fake-api.ts 的「${code}」不在 docs/API.md §3` });
  }

  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey } = process.env;
  const account = testAccount(input.rootEnvPath);
  if (!url || !anonKey) return [...issues, { check: "連線", detail: "缺少 SUPABASE_URL／SUPABASE_ANON_KEY（mcp-server/.env）" }];
  if (!account) return [...issues, { check: "連線", detail: "缺少測試帳號 VERIFY_EMAIL／VERIFY_PASSWORD（專案根目錄 .env）" }];
  const rest = await Rest.signIn(url, anonKey, account);

  // Tables, views and columns: what the fixtures hold and what the tools select.
  const toolSelects = readdirSync(input.toolsDir).filter((f) => f.endsWith(".ts"))
    .flatMap((f) => extractToolSelects(readFileSync(join(input.toolsDir, f), "utf8")).map((s) => ({ ...s, source: `tools/${f}` })));
  const selectChecks = toolSelects.map(async ({ table, select, source }) => {
    const r = await rest.get(`${table}?select=${encodeURIComponent(select)}&limit=0`);
    if (!r.ok) issues.push({ check: "工具查詢的欄位", detail: `${source}：${table}(${select}) → ${describe(r.error)}` });
  });

  const fixtureChecks = Object.entries(input.fixtures).flatMap(([name, tables]) => fixtureShape(tables).flatMap(({ table, columns, nested }) => [
    (async () => {
      const r = await rest.get(`${table}?select=${encodeURIComponent(columns.join(","))}&limit=0`);
      if (!r.ok) issues.push({ check: "假資料的欄位", detail: `fixtures/${name}.json ${table} → ${describe(r.error)}` });
    })(),
    // A nested object is either a json column or an embedded relation.
    ...nested.map(async (key) => {
      const asColumn = await rest.get(`${table}?select=${key}&limit=0`);
      if (asColumn.ok) return;
      const asRelation = await rest.get(`${table}?select=${key}(*)&limit=0`);
      if (!asRelation.ok) issues.push({ check: "假資料的欄位", detail: `fixtures/${name}.json ${table}.${key} 不是欄位也不是關聯 → ${describe(asRelation.error)}` });
    }),
  ]));

  // Status values: an enum column rejects an unknown value even in a filter.
  const statuses = [
    ...Object.entries(input.fixtures).flatMap(([name, t]) => fixtureStatuses(t).map((s) => ({ ...s, source: `fixtures/${name}.json` }))),
    ...toolEnumValues().map((s) => ({ ...s, source: `工具 ${s.tool}` })),
  ];
  const statusChecks = statuses.map(async ({ table, column, value, source }) => {
    const r = await rest.get(`${table}?select=${column}&${column}=eq.${encodeURIComponent(value)}&limit=0`);
    if (!r.ok) issues.push({ check: "狀態值", detail: `${source}：${table}.${column} = "${value}" → ${describe(r.error)}` });
  });

  // Simulated APIs: given the declared parameters plus one it lacks, PostgREST finds no function and
  // names the closest one's real parameters. Nothing runs.
  const apiChecks = Object.entries(input.apiParams).map(async ([name, params]) => {
    const r = await rest.rpc(name, { ...Object.fromEntries(params.map((p) => [p, null])), p__eval_db_check: null });
    const actual = parseSignatureHint(r.error?.hint);
    if (!actual) { issues.push({ check: "API 參數", detail: `${name}：無法取得資料庫中的參數（${describe(r.error) || r.status}）` }); return; }
    const missing = actual.filter((p) => !params.includes(p));
    const extra = params.filter((p) => !actual.includes(p));
    if (missing.length || extra.length) {
      issues.push({ check: "API 參數", detail: `${name}：fake-api.ts ${missing.length ? `缺少 ${missing.join(", ")}` : ""}${missing.length && extra.length ? "；" : ""}${extra.length ? `多出 ${extra.join(", ")}` : ""}` });
    }
  });

  const roleCheck = (async () => {
    const r = await rest.get("role_permissions?select=role,permission_key");
    if (!r.ok) { issues.push({ check: "角色權限", detail: `無法讀取 role_permissions：${describe(r.error)}` }); return; }
    issues.push(...compareRoles(input.roles, r.data as { role: string; permission_key: string }[]));
  })();

  await Promise.all([...selectChecks, ...fixtureChecks, ...statusChecks, ...apiChecks, roleCheck]);
  return issues.sort((a, b) => a.check.localeCompare(b.check) || a.detail.localeCompare(b.detail));
}
