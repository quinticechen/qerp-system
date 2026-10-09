import { z } from "zod";
import { defineTool, ok, fail } from "./types.js";
import { defineApiWriteTool } from "./api.js";

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

  defineApiWriteTool({
    name: "create_order",
    domain: "order",
    permission: "canCreateOrders",
    description: "建立新銷售訂單",
    input: z.object({
      customer_id: z.string().uuid().describe("客戶 UUID"),
      items: z.array(z.object({
        product_id: z.string().uuid().describe("產品 UUID"),
        quantity: z.number().positive().describe("數量（公斤）"),
        unit_price: z.number().nonnegative().describe("單價"),
      })).min(1).describe("訂單品項，至少一筆"),
      factory_ids: z.array(z.string().uuid()).optional().describe("指定工廠 UUID 列表"),
      note: z.string().optional().describe("備註"),
    }),
    rpc: "create_order",
    toParams: (i) => ({ p_customer_id: i.customer_id, p_items: i.items, p_factory_ids: i.factory_ids, p_note: i.note }),
  }),

  // Name and description kept from Phase 0 (wording is fragile — F7); backed by update_order.
  defineApiWriteTool({
    name: "update_order_status",
    domain: "order",
    permission: "canEditOrders",
    description: "更新訂單狀態、付款狀態或出貨狀態",
    input: z.object({
      order_id: z.string().uuid().describe("訂單 UUID"),
      status: z.enum(["pending", "confirmed", "factory_ordered", "completed"]).optional(),
      payment_status: PAYMENT_STATUS.optional(),
      shipping_status: SHIPPING_STATUS.optional(),
    }),
    rpc: "update_order",
    toParams: ({ order_id, ...changes }) => ({
      p_order_id: order_id,
      p_changes: Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)),
    }),
  }),
];
