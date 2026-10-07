import { z } from "zod";
import { defineTool, ok, fail, embeddedName, allInOrganization } from "./types.js";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, SHIPPING_STATUS_LABELS, fields } from "./labels.js";

const ORDER_STATUS = z.enum(["pending", "confirmed", "factory_ordered", "completed", "cancelled"]);
const PAYMENT_STATUS = z.enum(["unpaid", "partial_paid", "paid"]);
const SHIPPING_STATUS = z.enum(["not_started", "partial_shipped", "shipped"]);

export const orderTools = [
  defineTool({
    name: "list_orders",
    domain: "order",
    kind: "read",
    permission: "canViewOrders",
    description: "列出銷售訂單，可依狀態、付款狀態或客戶篩選",
    input: z.object({
      status: ORDER_STATUS.optional(),
      payment_status: PAYMENT_STATUS.optional(),
      customer_id: z.string().uuid().optional().describe("客戶 UUID"),
      limit: z.number().optional(),
    }),
    execute: async ({ supabase, organizationId }, { status, payment_status, customer_id, limit }) => {
      let q = supabase.from("orders").select("id, order_number, status, payment_status, shipping_status, created_at, customers(name)").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(limit ?? 20);
      if (status) q = q.eq("status", status);
      if (payment_status) q = q.eq("payment_status", payment_status);
      if (customer_id) q = q.eq("customer_id", customer_id);
      const { data, error } = await q;
      if (error) return fail(`查詢失敗：${error.message}`);
      return ok(data ?? []);
    },
  }),

  defineTool({
    name: "get_order",
    domain: "order",
    kind: "read",
    permission: "canViewOrders",
    description: "取得訂單完整詳情，含品項和工廠",
    input: z.object({
      order_id: z.string().uuid().describe("訂單 UUID"),
    }),
    execute: async ({ supabase, organizationId }, { order_id }) => {
      const { data, error } = await supabase.from("orders").select("*, customers(name, contact_person, phone), order_products(*, products_new(name, color)), order_factories(*, factories(name))").eq("id", order_id).eq("organization_id", organizationId).single();
      if (error) return fail(`找不到訂單：${error.message}`);
      return ok(data);
    },
  }),

  defineTool({
    name: "create_order",
    domain: "order",
    kind: "write",
    permission: "canCreateOrders",
    description: "建立新銷售訂單",
    input: z.object({
      customer_id: z.string().uuid().describe("客戶 UUID"),
      note: z.string().optional().describe("備註"),
    }),
    summarize: async ({ supabase, organizationId }, { customer_id, note }) => {
      const { data } = await supabase.from("customers").select("name").eq("id", customer_id).eq("organization_id", organizationId).maybeSingle();
      if (!data) return { ok: false, error: "建立失敗：找不到此客戶" };
      return { ok: true, summary: { title: "建立銷售訂單", fields: fields([["客戶", (data as { name: string }).name], ["備註", note]]) } };
    },
    execute: async (ctx, { customer_id, note }) => {
      const { supabase, organizationId } = ctx;
      if (!(await allInOrganization(ctx, "customers", [customer_id]))) return fail("建立失敗：找不到此客戶");
      const { data, error } = await supabase.from("orders").insert({
        order_number: `ORD-${Date.now()}`, customer_id, organization_id: organizationId, status: "pending",
        payment_status: "unpaid", shipping_status: "not_started", note: note ?? null,
      }).select("order_number, customers(name)").single();
      if (error) return fail(`建立失敗：${error.message}`);
      return ok({ message: "訂單建立成功", order_number: data.order_number, customer: embeddedName(data.customers) });
    },
  }),

  defineTool({
    name: "update_order_status",
    domain: "order",
    kind: "write",
    permission: "canEditOrders",
    description: "更新訂單狀態、付款狀態或出貨狀態",
    input: z.object({
      order_id: z.string().uuid().describe("訂單 UUID"),
      status: ORDER_STATUS.optional(),
      payment_status: PAYMENT_STATUS.optional(),
      shipping_status: SHIPPING_STATUS.optional(),
    }),
    summarize: async ({ supabase, organizationId }, { order_id, status, payment_status, shipping_status }) => {
      if (!status && !payment_status && !shipping_status) return { ok: false, error: "請至少指定一個要更新的欄位" };
      const { data } = await supabase.from("orders").select("order_number, status, payment_status, shipping_status")
        .eq("id", order_id).eq("organization_id", organizationId).maybeSingle();
      if (!data) return { ok: false, error: "更新失敗：找不到此訂單" };
      const order = data as { order_number: string; status: string; payment_status: string; shipping_status: string };
      const change = (labels: Record<string, string>, from: string, to?: string) =>
        to ? `${labels[from] ?? from} → ${labels[to] ?? to}` : null;
      return {
        ok: true,
        summary: {
          title: "更新訂單狀態",
          fields: fields([
            ["訂單", order.order_number],
            ["訂單狀態", change(ORDER_STATUS_LABELS, order.status, status)],
            ["付款狀態", change(PAYMENT_STATUS_LABELS, order.payment_status, payment_status)],
            ["出貨狀態", change(SHIPPING_STATUS_LABELS, order.shipping_status, shipping_status)],
          ]),
        },
      };
    },
    execute: async ({ supabase, organizationId }, { order_id, status, payment_status, shipping_status }) => {
      const updates: Record<string, string> = {};
      if (status) updates.status = status;
      if (payment_status) updates.payment_status = payment_status;
      if (shipping_status) updates.shipping_status = shipping_status;
      if (!Object.keys(updates).length) return fail("請至少指定一個要更新的欄位");
      const { data, error } = await supabase.from("orders").update(updates).eq("id", order_id).eq("organization_id", organizationId).select("order_number").single();
      if (error) return fail(`更新失敗：${error.message}`);
      return ok({ message: "訂單已更新", order_number: (data as { order_number: string }).order_number, updates });
    },
  }),
];
