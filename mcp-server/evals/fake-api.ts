/**
 * Simulated business APIs (docs/API.md §3) for the fake database.
 *
 * The real APIs are PL/pgSQL, covered by the RBAC session's SQL tests (supabase/tests/). Here we
 * only need what the agent's tests and evals depend on: which API was called with which
 * arguments, the checks that decide whether a draft is possible (records exist in this
 * organization, required fields, duplicate names), errors in the PostgREST shape
 * ({ code, message, hint }), and a summary for the card. A dry run writes nothing.
 */

import { randomUUID } from "node:crypto";
import type { RecordedWrite, Tables } from "./fake-supabase.js";

type Row = Record<string, unknown>;
type Params = Record<string, unknown>;

interface ApiError {
  code: string;
  message: string;
  hint: string;
}

interface Field {
  label: string;
  value: string;
}

const err = (code: string, hint: string, message: string): ApiError => ({ code, message, hint });
const notFound = (hint: string, message: string) => err("P0002", hint, message);
const invalid = (hint: string, message: string) => err("22023", hint, message);

function inOrg(tables: Tables, table: string, id: unknown, org: unknown): Row | undefined {
  return (tables[table] ?? []).find((r) => r.id === id && r.organization_id === org);
}

const productLabel = (p: Row) => [p.name, p.color].filter(Boolean).join(" - ");

interface ApiSpec {
  /** The key the real API checks first (api_require_permission). */
  permission: string;
  title: (p: Params, t: Tables) => string;
  /** Returns the card fields, or the first error the real API would raise. */
  check: (p: Params, t: Tables) => Field[] | ApiError;
  /** The row a real call inserts (table, values, document-number prefix). */
  insert?: (p: Params) => { table: string; values: Row; prefix?: string; numberColumn?: string };
}

function items(p: Params, t: Tables, quantityKey: string): Field[] | ApiError {
  const list = p.p_items as Row[] | undefined;
  if (!Array.isArray(list) || list.length === 0) return invalid("items_required", "至少需要一項產品");
  const fields: Field[] = [];
  for (const [i, item] of list.entries()) {
    const product = inOrg(t, "products_new", item.product_id, p.p_organization_id);
    if (!product) return notFound("product_not_found", "找不到此產品");
    if (product.status === "Unavailable") return invalid("product_unavailable", `產品「${productLabel(product)}」已停用`);
    if (!(Number(item[quantityKey]) > 0)) return invalid("invalid_quantity", "數量必須大於 0");
    fields.push({ label: `品項 ${i + 1}`, value: `${productLabel(product)} × ${item[quantityKey]} 公斤，單價 ${item.unit_price}` });
  }
  return fields;
}

const SPECS: Record<string, ApiSpec> = {
  create_customer: {
    permission: "canCreateCustomers",
    title: () => "建立客戶",
    check: (p, t) => {
      const name = String(p.p_name ?? "").trim();
      if (!name) return invalid("name_required", "請輸入客戶名稱");
      if (!String(p.p_contact_person ?? "").trim()) return invalid("contact_person_required", "請輸入聯絡人");
      if (!p.p_phone && !p.p_landline_phone) return invalid("phone_required", "手機或市話至少填一個");
      if ((t.customers ?? []).some((c) => c.organization_id === p.p_organization_id && String(c.name).toLowerCase() === name.toLowerCase())) {
        return err("23505", "customer_name_taken", `已有同名的客戶「${name}」`);
      }
      return [{ label: "公司名稱", value: name }, { label: "聯絡人", value: String(p.p_contact_person) }]
        .concat(p.p_phone ? [{ label: "手機", value: String(p.p_phone) }] : [])
        .concat(p.p_landline_phone ? [{ label: "市話", value: String(p.p_landline_phone) }] : []);
    },
    insert: (p) => ({ table: "customers", values: { name: p.p_name, contact_person: p.p_contact_person, phone: p.p_phone ?? null, organization_id: p.p_organization_id } }),
  },

  create_order: {
    permission: "canCreateOrders",
    title: () => "建立訂單",
    check: (p, t) => {
      const customer = inOrg(t, "customers", p.p_customer_id, p.p_organization_id);
      if (!customer) return notFound("customer_not_found", "找不到此客戶");
      if (customer.is_active === false) return invalid("customer_inactive", `客戶「${customer.name}」已停用`);
      const lines = items(p, t, "quantity");
      if (!Array.isArray(lines)) return lines;
      const factories: string[] = [];
      for (const id of (p.p_factory_ids as string[] | undefined) ?? []) {
        const f = inOrg(t, "factories", id, p.p_organization_id);
        if (!f) return notFound("factory_not_found", "找不到此工廠");
        factories.push(String(f.name));
      }
      return [{ label: "客戶", value: String(customer.name) }, ...lines]
        .concat(factories.length ? [{ label: "指定工廠", value: factories.join("、") }] : [])
        .concat(p.p_note ? [{ label: "備註", value: String(p.p_note) }] : []);
    },
    insert: (p) => ({ table: "orders", values: { customer_id: p.p_customer_id, organization_id: p.p_organization_id, status: "pending", note: p.p_note ?? null }, prefix: "B", numberColumn: "order_number" }),
  },

  update_order: {
    permission: "canEditOrders",
    title: (p, t) => `修改訂單 ${inOrg(t, "orders", p.p_order_id, p.p_organization_id)?.order_number ?? ""}`.trim(),
    check: (p, t) => {
      const order = inOrg(t, "orders", p.p_order_id, p.p_organization_id);
      if (!order) return notFound("order_not_found", "找不到此訂單");
      if (order.status === "cancelled") return err("55000", "order_cancelled", `訂單 ${order.order_number} 已取消，不能修改`);
      const changes = (p.p_changes ?? {}) as Row;
      const allowed = ["items", "factory_ids", "note", "status", "payment_status", "shipping_status"];
      const unknown = Object.keys(changes).filter((k) => !allowed.includes(k));
      if (unknown.length) return invalid("unknown_field", `不支援修改的欄位：${unknown.join("、")}`);
      if (changes.status === "cancelled") return invalid("use_cancel_order", "請使用取消訂單");
      return Object.entries(changes).map(([k, v]) => ({ label: k, value: `${String(order[k] ?? "（空白）")} → ${String(v)}` }));
    },
  },

  create_purchase_order: {
    permission: "canCreatePurchases",
    title: () => "建立採購單",
    check: (p, t) => {
      const factory = inOrg(t, "factories", p.p_factory_id, p.p_organization_id);
      if (!factory) return notFound("factory_not_found", "找不到此工廠");
      const lines = items(p, t, "ordered_quantity");
      if (!Array.isArray(lines)) return lines;
      const orders: string[] = [];
      for (const id of (p.p_order_ids as string[] | undefined) ?? []) {
        const o = inOrg(t, "orders", id, p.p_organization_id);
        if (!o) return notFound("order_not_found", "找不到此訂單");
        orders.push(String(o.order_number));
      }
      return [{ label: "工廠", value: String(factory.name) }]
        .concat(orders.length ? [{ label: "關聯訂單", value: orders.join("、") }] : [])
        .concat(lines);
    },
    insert: (p) => ({ table: "purchase_orders", values: { factory_id: p.p_factory_id, organization_id: p.p_organization_id, status: "confirmed" }, prefix: "P", numberColumn: "po_number" }),
  },
};

export const FAKE_API_NAMES = new Set(Object.keys(SPECS));

/** Simulates one API call against the fixture tables (mutating them on a real call). */
export function simulateApi(
  name: string, params: Params, tables: Tables, writes: RecordedWrite[], grants: readonly string[]
): { data: unknown; error: ApiError | null } {
  const spec = SPECS[name];
  if (!grants.includes(spec.permission)) return { data: null, error: err("42501", "forbidden", "您的角色沒有權限執行此操作") };
  const checked = spec.check(params, tables);
  if (!Array.isArray(checked)) return { data: null, error: checked };
  const summary = { title: spec.title(params, tables), fields: checked };
  if (params.p_dry_run) return { data: { dry_run: true, id: null, number: null, summary }, error: null };

  writes.push({ op: "rpc", table: name, values: params });
  const inserted = spec.insert?.(params);
  let id: string | null = (params.p_order_id ?? params.p_customer_id ?? null) as string | null;
  let number: string | null = null;
  if (inserted) {
    const rows = (tables[inserted.table] ??= []);
    id = randomUUID();
    if (inserted.prefix && inserted.numberColumn) number = `${inserted.prefix}20261009${String(rows.length + 1).padStart(4, "0")}`;
    const row = { id, ...inserted.values, ...(number && inserted.numberColumn ? { [inserted.numberColumn]: number } : {}) };
    rows.push(row);
    writes.push({ op: "insert", table: inserted.table, values: row });
  }
  return { data: { dry_run: false, id, number, summary }, error: null };
}
