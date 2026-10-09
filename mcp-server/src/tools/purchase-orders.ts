import { z } from "zod";
import { defineTool, ok, fail } from "./types.js";
import { defineApiWriteTool } from "./api.js";

export const purchaseOrderTools = [
  defineTool({
    name: "list_purchase_orders",
    domain: "purchase",
    kind: "read",
    permission: "canViewPurchases",
    description: "列出採購單，可依狀態或工廠篩選",
    input: z.object({
      status: z.enum(["pending", "confirmed", "in_production", "completed", "cancelled"]).optional(),
      factory_id: z.string().uuid().optional(),
      limit: z.number().optional(),
    }),
    execute: async ({ supabase, organizationId }, { status, factory_id, limit }) => {
      let q = supabase.from("purchase_orders").select("id, po_number, status, order_date, expected_arrival_date, factories(name)").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(limit ?? 20);
      if (status) q = q.eq("status", status);
      if (factory_id) q = q.eq("factory_id", factory_id);
      const { data, error } = await q;
      if (error) return fail(`查詢失敗：${error.message}`);
      return ok(data ?? []);
    },
  }),

  defineTool({
    name: "get_purchase_order",
    domain: "purchase",
    kind: "read",
    permission: "canViewPurchases",
    description: "取得採購單完整詳情含品項",
    input: z.object({
      purchase_order_id: z.string().uuid().describe("採購單 UUID"),
    }),
    execute: async ({ supabase, organizationId }, { purchase_order_id }) => {
      const { data, error } = await supabase.from("purchase_orders").select("*, factories(name, contact_person, phone), purchase_order_items(*, products_new(name, color))").eq("id", purchase_order_id).eq("organization_id", organizationId).single();
      if (error) return fail(`找不到採購單：${error.message}`);
      return ok(data);
    },
  }),

  defineApiWriteTool({
    name: "create_purchase_order",
    domain: "purchase",
    permission: "canCreatePurchases",
    description: "建立新採購單，需指定工廠與至少一項品項（產品、數量、單價）。可選擇關聯既有銷售訂單，關聯後該訂單狀態會自動更新為「已向工廠下單」。",
    input: z.object({
      factory_id: z.string().uuid().describe("工廠 UUID"),
      expected_arrival_date: z.string().optional().describe("預計到貨日期，格式 YYYY-MM-DD"),
      note: z.string().optional().describe("備註"),
      items: z.array(z.object({
        product_id: z.string().uuid().describe("產品 UUID"),
        ordered_quantity: z.number().positive().describe("訂購數量"),
        unit_price: z.number().positive().describe("單價"),
        specifications: z.string().optional().describe("規格說明，例如顏色、尺寸等備註"),
      })).min(1).describe("採購品項列表，至少一筆"),
      order_ids: z.array(z.string().uuid()).optional().describe("要關聯的銷售訂單 UUID 列表"),
    }),
    rpc: "create_purchase_order",
    toParams: (i) => ({
      p_factory_id: i.factory_id,
      p_items: i.items.map(({ specifications, ...item }) => ({ ...item, ...(specifications ? { specifications: { description: specifications } } : {}) })),
      p_order_ids: i.order_ids,
      p_expected_arrival_date: i.expected_arrival_date, p_note: i.note,
    }),
  }),
];
