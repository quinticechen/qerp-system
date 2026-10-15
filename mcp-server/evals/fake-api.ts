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
  /** The API's own error code; null for PostgREST errors, as in production. */
  hint: string | null;
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

// Card text mirrors the database's summary helpers (api_product_label, api_order_line_label,
// api_contact_fields, api_order_fields, api_purchase_order_fields), so a case's expected card
// fields hold against the real API too.
const productLabel = (p: Row) => `${p.name}${p.color ? ` - ${p.color}` : ""}${p.color_code ? `（色號 ${p.color_code}）` : ""}`;

/** Label/value pairs, leaving out empty values (api_fields). */
function fields(...pairs: [string, unknown][]): Field[] {
  return pairs.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "").map(([label, value]) => ({ label, value: String(value).trim() }));
}

/** Names joined in name order, as string_agg(… ORDER BY name). */
const joinNames = (names: string[]) => (names.length ? [...names].sort().join("、") : undefined);

/** Taiwan's date today, the default order date (api_today). */
const taiwanToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

interface ApiSpec {
  /** The key the real API checks first (api_require_permission). */
  permission: string;
  /**
   * The function's parameters (docs/API.md §3). A call with an unknown or missing parameter fails
   * as PostgREST would; evals/db-check.ts compares these names with the database before each eval.
   */
  params: { required: string[]; optional: string[] };
  title: (p: Params, t: Tables) => string;
  /** Returns the card fields, or the first error the real API would raise. */
  check: (p: Params, t: Tables) => Field[] | ApiError;
  /** The row a real call inserts (table, values, document-number prefix). */
  insert?: (p: Params) => { table: string; values: Row; prefix?: string; numberColumn?: string };
}

/** The item lines and their total (quantity × unit price). */
function items(p: Params, t: Tables, quantityKey: string): { lines: Field[]; total: number } | ApiError {
  const list = p.p_items as Row[] | undefined;
  if (!Array.isArray(list) || list.length === 0) return invalid("items_required", "至少需要一項產品");
  const lines: Field[] = [];
  let total = 0;
  for (const [i, item] of list.entries()) {
    const product = inOrg(t, "products_new", item.product_id, p.p_organization_id);
    if (!product) return notFound("product_not_found", "找不到此產品");
    if (product.status === "Unavailable") return invalid("product_unavailable", `產品「${productLabel(product)}」已停用`);
    if (!(Number(item[quantityKey]) > 0)) return invalid("invalid_quantity", "數量必須大於 0");
    if (Number(item.unit_price) < 0) return invalid("invalid_unit_price", "單價不可為負數");
    lines.push({ label: `品項 ${i + 1}`, value: `${productLabel(product)} × ${Number(item[quantityKey])} 公斤，單價 ${Number(item.unit_price)}` });
    total += Number(item[quantityKey]) * Number(item.unit_price);
  }
  return { lines, total };
}

/** Status labels (api_order_status_label, api_purchase_status_label). */
const ORDER_STATUS: Record<string, string> = {
  pending: "待確認", confirmed: "已確認", factory_ordered: "已向工廠下單", completed: "已完成", cancelled: "已取消",
  unpaid: "未付款", partial_paid: "部分付款", paid: "已付清", not_started: "未出貨", partial_shipped: "部分出貨", shipped: "已出貨",
};
const PURCHASE_STATUS: Record<string, string> = {
  pending: "待確認", confirmed: "已下單", partial_arrived: "部分到貨", partial_received: "部分入庫", completed: "已完成", cancelled: "已取消",
};
const QUALITIES = ["A", "B", "C", "D", "defective"];

const clean = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());

/** "舊 → 新" for each label whose value changes, empty shown as （空白） (api_changed_fields). */
function changed(...triples: [string, unknown, unknown][]): Field[] {
  return triples.filter(([, a, b]) => clean(a) !== clean(b))
    .map(([label, a, b]) => ({ label, value: `${clean(a) ?? "（空白）"} → ${clean(b) ?? "（空白）"}` }));
}

const activeLabel = (active: unknown) => (active === false ? "停用" : "啟用");
const colorLabel = (c: Row) =>
  `${c.color}${clean(c.color_code) ? `（色號 ${c.color_code}）` : ""}${clean(c.stock_threshold ?? c.stock_thresholds) !== null ? `，安全庫存 ${Number(c.stock_threshold ?? c.stock_thresholds)} 公斤` : ""}`;
const sameName = (rows: Row[] | undefined, org: unknown, name: string, exceptId?: unknown) =>
  (rows ?? []).find((r) => r.organization_id === org && r.id !== exceptId && String(r.name).trim().toLowerCase() === name.toLowerCase());

/** p_changes must be an object with known keys only (invalid_changes / unknown_field). */
function changesOf(p: Params, allowed: string[]): Row | ApiError {
  const changes = p.p_changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return invalid("invalid_changes", "修改內容格式不正確");
  const unknown = Object.keys(changes).filter((k) => !allowed.includes(k));
  return unknown.length ? invalid("unknown_field", `不支援修改的欄位：${unknown.join("、")}`) : (changes as Row);
}
const isError = (v: unknown): v is ApiError => !!v && typeof v === "object" && "code" in v && "hint" in v;

/** Customers and factories share their fields and rules (A1). */
const CONTACT_FIELDS: [key: string, label: string][] = [
  ["name", "名稱"], ["contact_person", "聯絡人"], ["phone", "手機"], ["landline_phone", "市話"],
  ["fax", "傳真"], ["email", "電子郵件"], ["address", "地址"], ["note", "備註"],
];
const CONTACT_PARAMS = ["p_phone", "p_landline_phone", "p_fax", "p_email", "p_address", "p_note", "p_dry_run"];

function partnerSpecs(table: "customers" | "factories", kind: "客戶" | "工廠", prefix: "customer" | "factory", keys: { create: string; edit: string }): Record<string, ApiSpec> {
  const idParam = `p_${prefix}_id`;
  const find = (p: Params, t: Tables) => inOrg(t, table, p[idParam], p.p_organization_id);
  const missing = notFound(`${prefix}_not_found`, `找不到此${kind}`);
  const validate = (v: Row): ApiError | null => {
    if (!clean(v.name)) return invalid("name_required", `請輸入${kind}名稱`);
    if (!clean(v.contact_person)) return invalid("contact_person_required", "請輸入聯絡人");
    if (!clean(v.phone) && !clean(v.landline_phone)) return invalid("phone_required", "手機或市話至少填一個");
    if (clean(v.email) && !/^[^@\s]+@[^@\s]+$/.test(String(v.email))) return invalid("invalid_email", "電子郵件格式不正確");
    return null;
  };
  return {
    [`create_${prefix}`]: {
      permission: keys.create,
      params: { required: ["p_organization_id", "p_name", "p_contact_person"], optional: CONTACT_PARAMS },
      title: () => `建立${kind}`,
      check: (p, t) => {
        const values = Object.fromEntries(CONTACT_FIELDS.map(([k]) => [k, p[`p_${k}`]]));
        const problem = validate(values);
        if (problem) return problem;
        if (sameName(t[table], p.p_organization_id, String(clean(p.p_name)))) return err("23505", `${prefix}_name_taken`, `已有同名的${kind}「${clean(p.p_name)}」`);
        return fields(...CONTACT_FIELDS.map(([k, label]): [string, unknown] => [label, p[`p_${k}`]]));
      },
      insert: (p) => ({ table, values: { ...Object.fromEntries(CONTACT_FIELDS.map(([k]) => [k, clean(p[`p_${k}`])])), is_active: true, organization_id: p.p_organization_id } }),
    },
    [`update_${prefix}`]: {
      permission: keys.edit,
      params: { required: ["p_organization_id", idParam, "p_changes"], optional: ["p_dry_run"] },
      title: (p, t) => `修改${kind}「${find(p, t)?.name ?? ""}」`,
      check: (p, t) => {
        const row = find(p, t);
        if (!row) return missing;
        const changes = changesOf(p, CONTACT_FIELDS.map(([k]) => k));
        if (isError(changes)) return changes;
        const merged = { ...row, ...changes };
        const problem = validate(merged);
        if (problem) return problem;
        if ("name" in changes && sameName(t[table], p.p_organization_id, String(clean(merged.name)), row.id)) {
          return err("23505", `${prefix}_name_taken`, `已有同名的${kind}「${clean(merged.name)}」`);
        }
        return changed(...CONTACT_FIELDS.filter(([k]) => k in changes).map(([k, label]): [string, unknown, unknown] => [label, row[k], changes[k]]));
      },
    },
    [`set_${prefix}_active`]: {
      permission: keys.edit,
      params: { required: ["p_organization_id", idParam, "p_is_active"], optional: ["p_dry_run"] },
      title: (p, t) => `${activeLabel(p.p_is_active)}${kind}「${find(p, t)?.name ?? ""}」`,
      check: (p, t) => {
        if (typeof p.p_is_active !== "boolean") return invalid("is_active_required", "請指定要啟用或停用");
        const row = find(p, t);
        if (!row) return missing;
        return changed(["狀態", activeLabel(row.is_active), activeLabel(p.p_is_active)]);
      },
    },
  };
}

/** A row of a table without organization_id, reached through its parent (rolls → inventories). */
function rollInOrg(t: Tables, id: unknown, org: unknown): Row | undefined {
  const roll = (t.inventory_rolls ?? []).find((r) => r.id === id);
  if (!roll) return undefined;
  const parent = (t.inventories ?? []).find((i) => i.id === roll.inventory_id) ?? (t.warehouses ?? []).find((w) => w.id === roll.warehouse_id);
  return parent?.organization_id === org ? roll : undefined;
}

/** "產品 1: 40S雙面布 - 藏青 × 2 卷，共 41.5 公斤" lines grouped by product (api_inventory_fields, api_shipping_fields). */
function productLines(t: Tables, entries: { productId: unknown; quantity: number }[]): Field[] {
  const byProduct = new Map<unknown, { rolls: number; total: number }>();
  for (const e of entries) {
    const g = byProduct.get(e.productId) ?? { rolls: 0, total: 0 };
    byProduct.set(e.productId, { rolls: g.rolls + 1, total: g.total + e.quantity });
  }
  return [...byProduct].map(([productId, g], i) => {
    const product = (t.products_new ?? []).find((p) => p.id === productId);
    return { label: `產品 ${i + 1}`, value: `${product ? productLabel(product) : "?"} × ${g.rolls} 卷，共 ${Number(g.total.toFixed(3))} 公斤` };
  });
}

const SPECS: Record<string, ApiSpec> = {
  create_customer: {
    permission: "canCreateCustomers",
    params: {
      required: ["p_organization_id", "p_name", "p_contact_person"],
      optional: ["p_phone", "p_landline_phone", "p_fax", "p_email", "p_address", "p_note", "p_dry_run"],
    },
    title: () => "建立客戶",
    check: (p, t) => {
      const name = String(p.p_name ?? "").trim();
      if (!name) return invalid("name_required", "請輸入客戶名稱");
      if (!String(p.p_contact_person ?? "").trim()) return invalid("contact_person_required", "請輸入聯絡人");
      if (!p.p_phone && !p.p_landline_phone) return invalid("phone_required", "手機或市話至少填一個");
      if ((t.customers ?? []).some((c) => c.organization_id === p.p_organization_id && String(c.name).toLowerCase() === name.toLowerCase())) {
        return err("23505", "customer_name_taken", `已有同名的客戶「${name}」`);
      }
      return fields(["名稱", name], ["聯絡人", p.p_contact_person], ["手機", p.p_phone], ["市話", p.p_landline_phone],
        ["傳真", p.p_fax], ["電子郵件", p.p_email], ["地址", p.p_address], ["備註", p.p_note]);
    },
    insert: (p) => ({ table: "customers", values: { name: p.p_name, contact_person: p.p_contact_person, phone: p.p_phone ?? null, organization_id: p.p_organization_id } }),
  },

  create_order: {
    permission: "canCreateOrders",
    params: { required: ["p_organization_id", "p_customer_id", "p_items"], optional: ["p_factory_ids", "p_note", "p_dry_run"] },
    title: () => "建立訂單",
    check: (p, t) => {
      const customer = inOrg(t, "customers", p.p_customer_id, p.p_organization_id);
      if (!customer) return notFound("customer_not_found", "找不到此客戶");
      if (customer.is_active === false) return invalid("customer_inactive", `客戶「${customer.name}」已停用`);
      const lines = items(p, t, "quantity");
      if ("code" in lines) return lines;
      const factories: string[] = [];
      for (const id of new Set((p.p_factory_ids as string[] | undefined) ?? [])) {
        const f = inOrg(t, "factories", id, p.p_organization_id);
        if (!f) return notFound("factory_not_found", "找不到此工廠");
        if (f.is_active === false) return invalid("factory_inactive", `工廠「${f.name}」已停用`);
        factories.push(String(f.name));
      }
      return [...fields(["客戶", customer.name]), ...lines.lines, ...fields(["指定工廠", joinNames(factories)], ["備註", p.p_note], ["訂單總額", lines.total])];
    },
    insert: (p) => ({ table: "orders", values: { customer_id: p.p_customer_id, organization_id: p.p_organization_id, status: "pending", note: p.p_note ?? null }, prefix: "B", numberColumn: "order_number" }),
  },

  update_order: {
    permission: "canEditOrders",
    params: { required: ["p_organization_id", "p_order_id", "p_changes"], optional: ["p_dry_run"] },
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
    params: {
      required: ["p_organization_id", "p_factory_id", "p_items"],
      optional: ["p_order_ids", "p_expected_arrival_date", "p_note", "p_order_date", "p_dry_run"],
    },
    title: () => "建立採購單",
    check: (p, t) => {
      const factory = inOrg(t, "factories", p.p_factory_id, p.p_organization_id);
      if (!factory) return notFound("factory_not_found", "找不到此工廠");
      if (factory.is_active === false) return invalid("factory_inactive", `工廠「${factory.name}」已停用`);
      const lines = items(p, t, "ordered_quantity");
      if ("code" in lines) return lines;
      const orders: string[] = [];
      for (const id of new Set((p.p_order_ids as string[] | undefined) ?? [])) {
        const o = inOrg(t, "orders", id, p.p_organization_id);
        if (!o) return notFound("order_not_found", "找不到此訂單");
        if (o.status === "cancelled") return err("55000", "order_cancelled", `訂單 ${o.order_number} 已取消`);
        orders.push(String(o.order_number));
      }
      return [
        ...fields(["工廠", factory.name], ["關聯訂單", joinNames(orders)]),
        ...lines.lines,
        ...fields(["下單日期", p.p_order_date ?? taiwanToday()], ["預計到貨日期", p.p_expected_arrival_date], ["備註", p.p_note], ["採購總額", lines.total]),
      ];
    },
    insert: (p) => ({ table: "purchase_orders", values: { factory_id: p.p_factory_id, organization_id: p.p_organization_id, status: "confirmed" }, prefix: "P", numberColumn: "po_number" }),
  },
  // ── Phase 1 APIs wrapped as tools (2026-10-15); card text follows each private.<api> ──────────

  // Replaces create_customer above with the same rules, and adds update_customer / set_customer_active.
  ...partnerSpecs("customers", "客戶", "customer", { create: "canCreateCustomers", edit: "canEditCustomers" }),
  ...partnerSpecs("factories", "工廠", "factory", { create: "canCreateFactories", edit: "canEditFactories" }),

  cancel_order: {
    permission: "canEditOrders",
    params: { required: ["p_organization_id", "p_order_id"], optional: ["p_reason", "p_dry_run"] },
    title: (p, t) => `取消訂單 ${inOrg(t, "orders", p.p_order_id, p.p_organization_id)?.order_number ?? ""}`,
    check: (p, t) => {
      const order = inOrg(t, "orders", p.p_order_id, p.p_organization_id);
      if (!order) return notFound("order_not_found", "找不到此訂單");
      if (order.status === "cancelled") return err("55000", "order_already_cancelled", `訂單 ${order.order_number} 已取消`);
      if ((t.shippings ?? []).some((s) => s.order_id === order.id && s.status !== "cancelled")) {
        return err("55000", "order_has_shipments", `訂單 ${order.order_number} 已有出貨紀錄，不能取消`);
      }
      const activePo = (t.purchase_order_relations ?? []).map((r) => (r.order_id === order.id ? (t.purchase_orders ?? []).find((po) => po.id === r.purchase_order_id) : undefined))
        .find((po) => po && po.status !== "cancelled");
      if (activePo) return err("55000", "order_has_purchase_orders", `訂單 ${order.order_number} 有進行中的採購單 ${activePo.po_number}，請先取消採購單`);
      return [...changed(["訂單狀態", ORDER_STATUS[String(order.status)] ?? order.status, "已取消"]), ...fields(["取消原因", p.p_reason])];
    },
  },

  update_purchase_order: {
    permission: "canEditPurchases",
    params: { required: ["p_organization_id", "p_purchase_order_id", "p_changes"], optional: ["p_dry_run"] },
    title: (p, t) => `修改採購單 ${inOrg(t, "purchase_orders", p.p_purchase_order_id, p.p_organization_id)?.po_number ?? ""}`,
    check: (p, t) => {
      const po = inOrg(t, "purchase_orders", p.p_purchase_order_id, p.p_organization_id);
      if (!po) return notFound("purchase_order_not_found", "找不到此採購單");
      if (po.status === "cancelled") return err("55000", "purchase_order_cancelled", `採購單 ${po.po_number} 已取消，不能修改`);
      const changes = changesOf(p, ["items", "order_ids", "factory_id", "order_date", "expected_arrival_date", "note", "status"]);
      if (isError(changes)) return changes;
      if (changes.status === "cancelled") return invalid("use_cancel_purchase_order", "請使用取消採購單");
      if ("status" in changes && !(String(changes.status) in PURCHASE_STATUS)) return invalid("invalid_status", "採購單狀態不正確");
      if ("factory_id" in changes && changes.factory_id !== po.factory_id) {
        if (["partial_received", "completed"].includes(String(po.status))) return err("55000", "purchase_order_received", `採購單 ${po.po_number} 已有入庫紀錄，不能更換工廠`);
        if (!inOrg(t, "factories", changes.factory_id, p.p_organization_id)) return notFound("factory_not_found", "找不到此工廠");
      }
      const factoryName = (id: unknown) => (t.factories ?? []).find((f) => f.id === id)?.name;
      return [
        ...changed(
          ["工廠", factoryName(po.factory_id), "factory_id" in changes ? factoryName(changes.factory_id) : factoryName(po.factory_id)],
          ["下單日期", po.order_date, "order_date" in changes ? changes.order_date : po.order_date],
          ["預計到貨日期", po.expected_arrival_date, "expected_arrival_date" in changes ? changes.expected_arrival_date : po.expected_arrival_date],
          ["備註", po.note, "note" in changes ? changes.note : po.note],
          ["狀態", PURCHASE_STATUS[String(po.status)], "status" in changes ? PURCHASE_STATUS[String(changes.status)] : PURCHASE_STATUS[String(po.status)]],
        ),
        ...("items" in changes ? [{ label: "品項", value: "更新品項" }] : []),
        ...("order_ids" in changes ? [{ label: "關聯訂單", value: "更新關聯訂單" }] : []),
      ];
    },
  },

  cancel_purchase_order: {
    permission: "canEditPurchases",
    params: { required: ["p_organization_id", "p_purchase_order_id"], optional: ["p_reason", "p_dry_run"] },
    title: (p, t) => `取消採購單 ${inOrg(t, "purchase_orders", p.p_purchase_order_id, p.p_organization_id)?.po_number ?? ""}`,
    check: (p, t) => {
      const po = inOrg(t, "purchase_orders", p.p_purchase_order_id, p.p_organization_id);
      if (!po) return notFound("purchase_order_not_found", "找不到此採購單");
      if (po.status === "cancelled") return err("55000", "purchase_order_already_cancelled", `採購單 ${po.po_number} 已取消`);
      const received = ["partial_received", "partial_arrived", "completed"].includes(String(po.status)) || (t.inventories ?? []).some((i) => i.purchase_order_id === po.id);
      if (received) return err("55000", "purchase_order_received", `採購單 ${po.po_number} 已有入庫紀錄，不能取消`);
      return [...changed(["狀態", PURCHASE_STATUS[String(po.status)] ?? po.status, "已取消"]), ...fields(["取消原因", p.p_reason])];
    },
  },

  receive_inventory: {
    permission: "canCreateInventory",
    params: { required: ["p_organization_id", "p_purchase_order_id", "p_rolls"], optional: ["p_arrival_date", "p_note", "p_dry_run"] },
    title: () => "入庫",
    check: (p, t) => {
      const po = inOrg(t, "purchase_orders", p.p_purchase_order_id, p.p_organization_id);
      if (!po) return notFound("purchase_order_not_found", "找不到此採購單");
      if (po.status === "cancelled") return err("55000", "purchase_order_cancelled", `採購單 ${po.po_number} 已取消，不能入庫`);
      const rolls = p.p_rolls as Row[] | undefined;
      if (!Array.isArray(rolls) || rolls.length === 0) return invalid("rolls_required", "入庫紀錄至少需要一卷布");
      const onOrder = new Set((t.purchase_order_items ?? []).filter((i) => i.purchase_order_id === po.id).map((i) => i.product_id));
      for (const roll of rolls) {
        const product = inOrg(t, "products_new", roll.product_id, p.p_organization_id);
        if (!product) return notFound("product_not_found", "找不到此產品");
        if (!onOrder.has(roll.product_id)) return invalid("product_not_on_purchase_order", `產品「${productLabel(product)}」不在採購單上`);
        if (!(Number(roll.quantity) > 0)) return invalid("invalid_quantity", "布卷重量必須大於 0");
        if (roll.quality !== undefined && !QUALITIES.includes(String(roll.quality))) return invalid("invalid_quality", "品質不正確");
        const shelf = inOrg(t, "warehouses", roll.warehouse_id, p.p_organization_id);
        if (!shelf) return notFound("warehouse_not_found", "找不到此倉庫");
        if (shelf.is_active === false) return invalid("warehouse_inactive", `貨架「${shelf.name}」已停用`);
      }
      const factory = (t.factories ?? []).find((f) => f.id === po.factory_id);
      const total = rolls.reduce((sum, r) => sum + Number(r.quantity), 0);
      return [
        ...fields(["採購單", po.po_number], ["工廠", factory?.name], ["到貨日期", p.p_arrival_date ?? taiwanToday()]),
        ...productLines(t, rolls.map((r) => ({ productId: r.product_id, quantity: Number(r.quantity) }))),
        ...fields(["備註", p.p_note], ["合計", `${rolls.length} 卷，共 ${Number(total.toFixed(3))} 公斤`]),
      ];
    },
    insert: (p) => ({ table: "inventories", values: { purchase_order_id: p.p_purchase_order_id, arrival_date: p.p_arrival_date ?? taiwanToday(), note: p.p_note ?? null, organization_id: p.p_organization_id }, prefix: "I", numberColumn: "receipt_number" }),
  },

  update_inventory: {
    permission: "canEditInventory",
    params: { required: ["p_organization_id", "p_inventory_id", "p_changes"], optional: ["p_dry_run"] },
    title: (p, t) => `修改進貨單 ${inOrg(t, "inventories", p.p_inventory_id, p.p_organization_id)?.receipt_number ?? ""}`,
    check: (p, t) => {
      const inventory = inOrg(t, "inventories", p.p_inventory_id, p.p_organization_id);
      if (!inventory) return notFound("inventory_not_found", "找不到此入庫紀錄");
      const changes = changesOf(p, ["rolls", "arrival_date", "note"]);
      if (isError(changes)) return changes;
      return [
        ...changed(["到貨日期", inventory.arrival_date, "arrival_date" in changes ? changes.arrival_date : inventory.arrival_date], ["備註", inventory.note, "note" in changes ? changes.note : inventory.note]),
        ...("rolls" in changes ? [{ label: "布卷", value: "更新布卷" }] : []),
      ];
    },
  },

  update_inventory_roll: {
    permission: "canEditInventory",
    params: { required: ["p_organization_id", "p_roll_id", "p_changes"], optional: ["p_dry_run"] },
    title: (p, t) => `修改布卷 ${rollInOrg(t, p.p_roll_id, p.p_organization_id)?.roll_number ?? ""}`,
    check: (p, t) => {
      const roll = rollInOrg(t, p.p_roll_id, p.p_organization_id);
      if (!roll) return notFound("roll_not_found", "找不到此布卷");
      const changes = changesOf(p, ["quantity", "quality", "warehouse_id", "shelf"]);
      if (isError(changes)) return changes;
      if ("quantity" in changes && !(Number(changes.quantity) > 0)) return invalid("invalid_quantity", "布卷重量必須大於 0");
      if ("quality" in changes && !QUALITIES.includes(String(changes.quality))) return invalid("invalid_quality", "品質不正確");
      const shelfName = (id: unknown) => (t.warehouses ?? []).find((w) => w.id === id)?.name;
      if ("warehouse_id" in changes) {
        const shelf = inOrg(t, "warehouses", changes.warehouse_id, p.p_organization_id);
        if (!shelf) return notFound("warehouse_not_found", "找不到此倉庫");
        if (shelf.is_active === false) return invalid("warehouse_inactive", `貨架「${shelf.name}」已停用`);
      }
      const after = { ...roll, ...changes };
      // api_roll_label: "R… 產品 - 顏色 21.5 公斤（A 級，倉庫 A區-01 架位）"
      const label = (r: Row) => {
        const product = (t.products_new ?? []).find((x) => x.id === r.product_id);
        const quality = r.quality === "defective" ? "瑕疵" : `${r.quality} 級`;
        const shelf = shelfName(r.warehouse_id);
        return `${[r.roll_number, product ? productLabel(product) : null, `${Number(r.quantity)} 公斤`].filter(Boolean).join(" ")}（${quality}${shelf ? `，倉庫 ${shelf}` : ""}${clean(r.shelf) ? ` ${clean(r.shelf)}` : ""}）`;
      };
      const receipt = (t.inventories ?? []).find((i) => i.id === roll.inventory_id)?.receipt_number;
      return [...fields(["進貨單", receipt]), ...(label(roll) !== label(after) ? [{ label: "修改布卷", value: `${label(roll)} → ${label(after)}` }] : [])];
    },
  },

  create_shipping: {
    permission: "canCreateShipping",
    params: { required: ["p_organization_id", "p_order_id", "p_items"], optional: ["p_shipping_date", "p_note", "p_dry_run"] },
    title: () => "建立出貨單",
    check: (p, t) => {
      const order = inOrg(t, "orders", p.p_order_id, p.p_organization_id);
      if (!order) return notFound("order_not_found", "找不到此訂單");
      if (order.status === "cancelled") return err("55000", "order_cancelled", `訂單 ${order.order_number} 已取消，不能出貨`);
      const items = p.p_items as Row[] | undefined;
      if (!Array.isArray(items) || items.length === 0) return invalid("items_required", "出貨單至少需要一卷布");
      const onOrder = new Set((t.order_products ?? []).filter((op) => op.order_id === order.id).map((op) => op.product_id));
      const entries: { productId: unknown; quantity: number }[] = [];
      for (const item of items) {
        const roll = rollInOrg(t, item.inventory_roll_id, p.p_organization_id);
        if (!roll) return notFound("roll_not_found", "找不到此布卷");
        if (!onOrder.has(roll.product_id)) return invalid("roll_not_in_order", `布卷「${roll.roll_number}」的產品不在此訂單中`);
        const quantity = Number(item.shipped_quantity);
        if (!(quantity > 0)) return invalid("invalid_quantity", "出貨重量必須大於 0");
        const left = Number(roll.current_quantity ?? roll.quantity);
        if (quantity > left) return err("55000", "insufficient_stock", `布卷「${roll.roll_number}」庫存不足，最多可再出貨 ${left} 公斤`);
        entries.push({ productId: roll.product_id, quantity });
      }
      const customer = (t.customers ?? []).find((c) => c.id === order.customer_id);
      const total = entries.reduce((sum, e) => sum + e.quantity, 0);
      return [
        ...fields(["訂單", order.order_number], ["客戶", customer?.name], ["出貨日期", p.p_shipping_date ?? taiwanToday()]),
        ...productLines(t, entries),
        ...fields(["備註", p.p_note], ["合計", `${entries.length} 卷，共 ${Number(total.toFixed(3))} 公斤`]),
      ];
    },
    insert: (p) => ({ table: "shippings", values: { order_id: p.p_order_id, shipping_date: p.p_shipping_date ?? taiwanToday(), status: "shipped", organization_id: p.p_organization_id }, prefix: "O", numberColumn: "shipping_number" }),
  },

  update_shipping: {
    permission: "canEditShipping",
    params: { required: ["p_organization_id", "p_shipping_id", "p_changes"], optional: ["p_dry_run"] },
    title: (p, t) => `修改出貨單 ${inOrg(t, "shippings", p.p_shipping_id, p.p_organization_id)?.shipping_number ?? ""}`,
    check: (p, t) => {
      const shipping = inOrg(t, "shippings", p.p_shipping_id, p.p_organization_id);
      if (!shipping) return notFound("shipping_not_found", "找不到此出貨單");
      if (shipping.status === "cancelled") return err("55000", "shipping_cancelled", `出貨單 ${shipping.shipping_number} 已取消`);
      const changes = changesOf(p, ["items", "shipping_date", "note"]);
      if (isError(changes)) return changes;
      return [
        ...changed(["出貨日期", shipping.shipping_date, "shipping_date" in changes ? changes.shipping_date : shipping.shipping_date], ["備註", shipping.note, "note" in changes ? changes.note : shipping.note]),
        ...("items" in changes ? [{ label: "布卷", value: "更新布卷" }] : []),
      ];
    },
  },

  cancel_shipping: {
    permission: "canEditShipping",
    params: { required: ["p_organization_id", "p_shipping_id"], optional: ["p_reason", "p_dry_run"] },
    title: (p, t) => `取消出貨單 ${inOrg(t, "shippings", p.p_shipping_id, p.p_organization_id)?.shipping_number ?? ""}`,
    check: (p, t) => {
      const shipping = inOrg(t, "shippings", p.p_shipping_id, p.p_organization_id);
      if (!shipping) return notFound("shipping_not_found", "找不到此出貨單");
      if (shipping.status === "cancelled") return err("55000", "shipping_already_cancelled", `出貨單 ${shipping.shipping_number} 已取消`);
      return [...changed(["狀態", "已出貨", "已取消"]), ...fields(["取消原因", p.p_reason])];
    },
  },

  create_product: {
    permission: "canCreateProducts",
    params: { required: ["p_organization_id", "p_name", "p_colors"], optional: ["p_category", "p_unit_of_measure", "p_dry_run"] },
    title: () => "建立產品",
    check: (p, t) => {
      const name = clean(p.p_name);
      if (!name) return invalid("name_required", "請輸入產品名稱");
      const colors = p.p_colors as Row[] | undefined;
      if (!Array.isArray(colors) || colors.length === 0) return invalid("colors_required", "產品至少需要一個顏色");
      if (colors.some((c) => !clean(c.color))) return invalid("color_required", "請輸入顏色");
      if (sameName(t.product_groups, p.p_organization_id, name)) return err("23505", "product_name_taken", `已有同名的產品「${name}」，請在該產品下新增顏色`);
      return [
        ...fields(["產品名稱", name], ["類別", clean(p.p_category) ?? "布料"], ["單位", clean(p.p_unit_of_measure) ?? "KG"]),
        ...colors.map((c, i) => ({ label: `顏色 ${i + 1}`, value: colorLabel(c) })),
      ];
    },
    insert: (p) => ({ table: "product_groups", values: { name: clean(p.p_name), category: clean(p.p_category) ?? "布料", unit_of_measure: clean(p.p_unit_of_measure) ?? "KG", is_active: true, organization_id: p.p_organization_id } }),
  },

  update_product: {
    permission: "canEditProducts",
    params: { required: ["p_organization_id", "p_product_id", "p_changes"], optional: ["p_dry_run"] },
    title: (p, t) => `修改產品「${inOrg(t, "product_groups", p.p_product_id, p.p_organization_id)?.name ?? ""}」`,
    check: (p, t) => {
      const group = inOrg(t, "product_groups", p.p_product_id, p.p_organization_id);
      if (!group) return notFound("product_not_found", "找不到此產品");
      const changes = changesOf(p, ["name", "category", "unit_of_measure"]);
      if (isError(changes)) return changes;
      if ("name" in changes && sameName(t.product_groups, p.p_organization_id, String(clean(changes.name)), group.id)) {
        return err("23505", "product_name_taken", `已有同名的產品「${clean(changes.name)}」，請在該產品下新增顏色`);
      }
      return changed(...([["name", "產品名稱"], ["category", "類別"], ["unit_of_measure", "單位"]] as const)
        .filter(([k]) => k in changes).map(([k, label]): [string, unknown, unknown] => [label, group[k], changes[k]]));
    },
  },

  set_product_active: {
    permission: "canEditProducts",
    params: { required: ["p_organization_id", "p_product_id", "p_is_active"], optional: ["p_dry_run"] },
    title: (p, t) => `${activeLabel(p.p_is_active)}產品「${inOrg(t, "product_groups", p.p_product_id, p.p_organization_id)?.name ?? ""}」`,
    check: (p, t) => {
      if (typeof p.p_is_active !== "boolean") return invalid("is_active_required", "請指定要啟用或停用");
      const group = inOrg(t, "product_groups", p.p_product_id, p.p_organization_id);
      if (!group) return notFound("product_not_found", "找不到此產品");
      return changed(["狀態", activeLabel(group.is_active), activeLabel(p.p_is_active)]);
    },
  },

  add_product_color: {
    permission: "canCreateProducts",
    params: { required: ["p_organization_id", "p_product_id", "p_color"], optional: ["p_color_code", "p_color_hex", "p_stock_threshold", "p_dry_run"] },
    title: (p, t) => `新增顏色到「${inOrg(t, "product_groups", p.p_product_id, p.p_organization_id)?.name ?? ""}」`,
    check: (p, t) => {
      const group = inOrg(t, "product_groups", p.p_product_id, p.p_organization_id);
      if (!group) return notFound("product_not_found", "找不到此產品");
      const color = clean(p.p_color);
      if (!color) return invalid("color_required", "請輸入顏色");
      if (clean(p.p_color_hex) && !/^#[0-9A-Fa-f]{6}$/.test(String(p.p_color_hex))) return invalid("invalid_color_hex", "色值格式不正確，請使用 #RRGGBB");
      const taken = (t.products_new ?? []).some((c) => c.group_id === group.id && String(c.color).toLowerCase() === color.toLowerCase() && clean(c.color_code) === clean(p.p_color_code));
      if (taken) return err("23505", "product_color_taken", `此產品已有顏色「${color}」`);
      return fields(["顏色", color], ["色號", p.p_color_code], ["色值", p.p_color_hex], ["安全庫存", p.p_stock_threshold === undefined || p.p_stock_threshold === null ? null : `${Number(p.p_stock_threshold)} 公斤`]);
    },
  },

  update_product_color: {
    permission: "canEditProducts",
    params: { required: ["p_organization_id", "p_color_id", "p_changes"], optional: ["p_dry_run"] },
    title: (p, t) => {
      const c = inOrg(t, "products_new", p.p_color_id, p.p_organization_id);
      return `修改顏色「${c ? productLabel(c) : ""}」`;
    },
    check: (p, t) => {
      const c = inOrg(t, "products_new", p.p_color_id, p.p_organization_id);
      if (!c) return notFound("product_color_not_found", "找不到此顏色");
      const changes = changesOf(p, ["color", "color_code", "color_hex", "stock_threshold"]);
      if (isError(changes)) return changes;
      if ("stock_threshold" in changes && changes.stock_threshold !== null && changes.stock_threshold !== "" && Number(changes.stock_threshold) < 0) {
        return invalid("invalid_stock_threshold", "安全庫存不可為負數");
      }
      return changed(
        ...([["color", "顏色"], ["color_code", "色號"], ["color_hex", "色值"]] as const).filter(([k]) => k in changes).map(([k, label]): [string, unknown, unknown] => [label, c[k], changes[k]]),
        ...("stock_threshold" in changes ? [["安全庫存", c.stock_thresholds, changes.stock_threshold] as [string, unknown, unknown]] : []),
      );
    },
  },

  set_product_color_active: {
    permission: "canEditProducts",
    params: { required: ["p_organization_id", "p_color_id", "p_is_active"], optional: ["p_dry_run"] },
    title: (p, t) => {
      const c = inOrg(t, "products_new", p.p_color_id, p.p_organization_id);
      return `${activeLabel(p.p_is_active)}顏色「${c ? productLabel(c) : ""}」`;
    },
    check: (p, t) => {
      if (typeof p.p_is_active !== "boolean") return invalid("is_active_required", "請指定要啟用或停用");
      const c = inOrg(t, "products_new", p.p_color_id, p.p_organization_id);
      if (!c) return notFound("product_color_not_found", "找不到此顏色");
      return changed(["狀態", activeLabel(c.status !== "Unavailable"), activeLabel(p.p_is_active)]);
    },
  },

  create_shelf: {
    permission: "canCreateShelves",
    params: { required: ["p_organization_id", "p_name"], optional: ["p_location", "p_dry_run"] },
    title: () => "建立貨架",
    check: (p, t) => {
      const name = clean(p.p_name);
      if (!name) return invalid("name_required", "請輸入貨架名稱");
      if (sameName(t.warehouses, p.p_organization_id, name)) return err("23505", "shelf_name_taken", `已有同名的貨架「${name}」`);
      return fields(["貨架名稱", name], ["位置", p.p_location]);
    },
    insert: (p) => ({ table: "warehouses", values: { name: clean(p.p_name), location: clean(p.p_location), is_active: true, organization_id: p.p_organization_id } }),
  },

  update_shelf: {
    permission: "canEditShelves",
    params: { required: ["p_organization_id", "p_shelf_id", "p_changes"], optional: ["p_dry_run"] },
    title: (p, t) => `修改貨架「${inOrg(t, "warehouses", p.p_shelf_id, p.p_organization_id)?.name ?? ""}」`,
    check: (p, t) => {
      const shelf = inOrg(t, "warehouses", p.p_shelf_id, p.p_organization_id);
      if (!shelf) return notFound("shelf_not_found", "找不到此貨架");
      const changes = changesOf(p, ["name", "location"]);
      if (isError(changes)) return changes;
      const name = "name" in changes ? clean(changes.name) : clean(shelf.name);
      if (!name) return invalid("name_required", "請輸入貨架名稱");
      if (sameName(t.warehouses, p.p_organization_id, name, shelf.id)) return err("23505", "shelf_name_taken", `已有同名的貨架「${name}」`);
      return changed(["貨架名稱", shelf.name, name], ["位置", shelf.location, "location" in changes ? changes.location : shelf.location]);
    },
  },

  set_shelf_active: {
    permission: "canEditShelves",
    params: { required: ["p_organization_id", "p_shelf_id", "p_is_active"], optional: ["p_dry_run"] },
    title: (p, t) => `${activeLabel(p.p_is_active)}貨架「${inOrg(t, "warehouses", p.p_shelf_id, p.p_organization_id)?.name ?? ""}」`,
    check: (p, t) => {
      if (typeof p.p_is_active !== "boolean") return invalid("is_active_required", "請指定要啟用或停用");
      const shelf = inOrg(t, "warehouses", p.p_shelf_id, p.p_organization_id);
      if (!shelf) return notFound("shelf_not_found", "找不到此貨架");
      const stored = (t.inventory_rolls ?? []).filter((r) => r.warehouse_id === shelf.id && Number(r.current_quantity ?? r.quantity) > 0);
      const stock = stored.length ? `${stored.length} 卷，共 ${Number(stored.reduce((s, r) => s + Number(r.current_quantity ?? r.quantity), 0).toFixed(3))} 公斤` : null;
      return [...changed(["狀態", activeLabel(shelf.is_active), activeLabel(p.p_is_active)]), ...(p.p_is_active ? [] : fields(["仍有庫存", stock]))];
    },
  },
};

export const FAKE_API_NAMES = new Set(Object.keys(SPECS));

/** Every parameter name of each simulated API, for evals/db-check.ts. */
export function fakeApiParams(): Record<string, string[]> {
  return Object.fromEntries(Object.entries(SPECS).map(([name, { params }]) => [name, [...params.required, ...params.optional].sort()]));
}

/** PostgREST resolves a function by its parameter names: unknown or missing ones find no function. */
function signatureError(name: string, spec: ApiSpec, params: Params): ApiError | null {
  const known = new Set([...spec.params.required, ...spec.params.optional]);
  const unknown = Object.keys(params).filter((k) => !known.has(k));
  const missing = spec.params.required.filter((k) => !(k in params));
  if (!unknown.length && !missing.length) return null;
  return { code: "PGRST202", message: `Could not find the function public.${name}(${Object.keys(params).sort().join(", ")}) in the schema cache`, hint: null };
}

/** Simulates one API call against the fixture tables (mutating them on a real call). */
export function simulateApi(
  name: string, params: Params, tables: Tables, writes: RecordedWrite[], grants: readonly string[]
): { data: unknown; error: ApiError | null } {
  const spec = SPECS[name];
  const signature = signatureError(name, spec, params);
  if (signature) return { data: null, error: signature };
  if (!grants.includes(spec.permission)) return { data: null, error: err("42501", "forbidden", "您的角色沒有權限執行此操作") };
  const checked = spec.check(params, tables);
  if (!Array.isArray(checked)) return { data: null, error: checked };
  const summary = { title: spec.title(params, tables), fields: checked };
  if (params.p_dry_run) return { data: { dry_run: true, id: null, number: null, summary }, error: null };

  writes.push({ op: "rpc", table: name, values: params });
  const inserted = spec.insert?.(params);
  // The record an update, cancel or set_active call is about: its first p_<record>_id parameter.
  const target = Object.entries(params).find(([k]) => k !== "p_organization_id" && /^p_\w+_id$/.test(k));
  let id: string | null = (target?.[1] ?? null) as string | null;
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
