import { z } from "zod";
import { refInput } from "./refs.js";
import { defineTool, ok, fail } from "./types.js";
import { compact, defineApiWriteTool } from "./api.js";
import { mergeLines, PRODUCT_NAMING } from "./line-items.js";

const ORDER_STATUS = z.enum(["pending", "confirmed", "factory_ordered", "completed", "cancelled"]);
const PAYMENT_STATUS = z.enum(["unpaid", "partial_paid", "paid"]);

export const orderTools = [
  defineTool({
    name: "list_orders",
    domain: "order",
    kind: "read",
    permission: "canViewOrders",
    refs: { customer_id: "customer" },
    description: "列出銷售訂單，可依狀態、付款狀態或客戶篩選",
    input: z.object({
      status: ORDER_STATUS.optional(),
      payment_status: PAYMENT_STATUS.optional(),
      customer_id: refInput("客戶名稱或 UUID").optional(),
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
    refs: { order_id: "order" },
    description: "取得訂單完整詳情，含品項和工廠",
    input: z.object({
      order_id: refInput("訂單編號或 UUID"),
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
    refs: { customer_id: "customer", "factory_ids[]": "factory" },
    description: "建立新銷售訂單",
    input: z.object({
      customer_id: refInput("客戶名稱或 UUID"),
      items: z.array(z.object({
        product_id: z.string().uuid().describe("產品 UUID"),
        quantity: z.number().positive().describe("數量（公斤）"),
        unit_price: z.number().nonnegative().describe("單價"),
      })).min(1).describe("訂單品項，至少一筆"),
      factory_ids: z.array(refInput("工廠名稱或 UUID")).optional().describe("指定工廠的名稱或 UUID"),
      note: z.string().optional().describe("備註"),
    }),
    rpc: "create_order",
    toParams: (i) => ({ p_customer_id: i.customer_id, p_items: i.items, p_factory_ids: i.factory_ids, p_note: i.note }),
  }),

  // Name kept from Phase 0 (wording is fragile — F7); backed by update_order. No shipping_status:
  // shipments compute it, and the model used it to fake a shipment instead of create_shipping.
  defineApiWriteTool({
    name: "update_order_status",
    domain: "order",
    permission: "canEditOrders",
    refs: { order_id: "order" },
    description: "更新訂單狀態或付款狀態",
    input: z.object({
      order_id: refInput("訂單編號或 UUID"),
      status: z.enum(["pending", "confirmed", "factory_ordered", "completed"]).optional(),
      payment_status: PAYMENT_STATUS.optional(),
    }),
    rpc: "update_order",
    toParams: ({ order_id, ...changes }) => ({
      p_order_id: order_id,
      p_changes: Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)),
    }),
  }),

  defineApiWriteTool({
    name: "update_order",
    domain: "order",
    permission: "canEditOrders",
    refs: { order_id: "order", "factory_ids[]": "factory" },
    description: "修改訂單的品項、指定工廠或備註；只列出要新增、修改或移除的品項",
    input: z.object({
      order_id: refInput("訂單編號或 UUID"),
      set_items: z.array(z.object({
        product_id: z.string().uuid().optional().describe("產品 UUID；訂單只有一個品項時可省略"),
        quantity: z.number().positive().optional().describe("數量（公斤）"),
        unit_price: z.number().nonnegative().optional().describe("單價"),
      })).optional().describe("要新增或修改的品項；已在訂單上的產品只改有填的欄位，單價不變時不用填"),
      remove_product_ids: z.array(z.string().uuid()).optional().describe("要從訂單移除的產品 UUID"),
      factory_ids: z.array(refInput("工廠名稱或 UUID")).optional().describe("完整的指定工廠列表，取代現有的"),
      note: z.string().optional().describe("備註；空字串清除"),
    }),
    rpc: "update_order",
    toParams: async (i, ctx) => {
      let items: Record<string, unknown>[] | undefined;
      if (i.set_items?.length || i.remove_product_ids?.length) {
        const merged = await mergeLines(ctx, {
          parentTable: "orders", parentId: i.order_id, notFound: "找不到此訂單",
          table: "order_products", parentColumn: "order_id", key: "product_id", parentLabel: "訂單", naming: PRODUCT_NAMING,
          columns: ["id", "product_id", "quantity", "unit_price", "total_rolls", "specifications"],
        }, { upsert: i.set_items, remove: i.remove_product_ids }, { quantity: "數量", unit_price: "單價" });
        if (!Array.isArray(merged)) return merged;
        items = merged;
      }
      return { p_order_id: i.order_id, p_changes: compact({ items, factory_ids: i.factory_ids, note: i.note }) };
    },
  }),

  defineApiWriteTool({
    name: "cancel_order",
    domain: "order",
    permission: "canEditOrders",
    refs: { order_id: "order" },
    description: "取消訂單；已有出貨或進行中的採購單時不能取消",
    input: z.object({
      order_id: refInput("訂單編號或 UUID"),
      reason: z.string().optional().describe("取消原因；使用者沒說就不要填"),
    }),
    rpc: "cancel_order",
    toParams: (i) => ({ p_order_id: i.order_id, p_reason: i.reason }),
  }),
];
