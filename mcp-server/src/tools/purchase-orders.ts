import { z } from "zod";
import { refInput } from "./refs.js";
import { defineTool, ok, fail } from "./types.js";
import { compact, defineApiWriteTool } from "./api.js";
import { mergeLines, PRODUCT_NAMING } from "./line-items.js";

export const purchaseOrderTools = [
  defineTool({
    name: "list_purchase_orders",
    domain: "purchase",
    kind: "read",
    permission: "canViewPurchases",
    refs: { factory_id: "factory" },
    description: "列出採購單，可依狀態或工廠篩選",
    input: z.object({
      status: z.enum(["pending", "confirmed", "partial_received", "completed", "cancelled"]).optional(),
      factory_id: refInput("工廠名稱或 UUID").optional(),
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
    refs: { purchase_order_id: "purchase_order" },
    description: "取得採購單完整詳情含品項",
    input: z.object({
      purchase_order_id: refInput("採購單號或 UUID"),
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
    refs: { factory_id: "factory", "order_ids[]": "order" },
    description: "建立新採購單，需指定工廠與至少一項品項（產品、數量、單價）。可選擇關聯既有銷售訂單，關聯後該訂單狀態會自動更新為「已向工廠下單」。",
    input: z.object({
      factory_id: refInput("工廠名稱或 UUID"),
      expected_arrival_date: z.string().optional().describe("預計到貨日期，格式 YYYY-MM-DD"),
      note: z.string().optional().describe("備註"),
      items: z.array(z.object({
        product_id: z.string().uuid().describe("產品 UUID"),
        ordered_quantity: z.number().positive().describe("訂購數量"),
        unit_price: z.number().positive().describe("單價"),
        specifications: z.string().optional().describe("規格說明，例如顏色、尺寸等備註"),
      })).min(1).describe("採購品項列表，至少一筆"),
      order_ids: z.array(refInput("訂單編號或 UUID")).optional().describe("要關聯的銷售訂單"),
    }),
    rpc: "create_purchase_order",
    toParams: (i) => ({
      p_factory_id: i.factory_id,
      p_items: i.items.map(({ specifications, ...item }) => ({ ...item, ...(specifications ? { specifications: { description: specifications } } : {}) })),
      p_order_ids: i.order_ids,
      p_expected_arrival_date: i.expected_arrival_date, p_note: i.note,
    }),
  }),

  defineApiWriteTool({
    name: "update_purchase_order",
    domain: "purchase",
    permission: "canEditPurchases",
    refs: { purchase_order_id: "purchase_order", factory_id: "factory", "order_ids[]": "order" },
    description: "修改採購單的品項、工廠、關聯訂單、日期或備註；只列出要新增、修改或移除的品項",
    input: z.object({
      purchase_order_id: refInput("採購單號或 UUID"),
      set_items: z.array(z.object({
        product_id: z.string().uuid().optional().describe("產品 UUID；採購單只有一個品項時可省略"),
        ordered_quantity: z.number().positive().optional().describe("訂購數量"),
        unit_price: z.number().nonnegative().optional().describe("單價"),
      })).optional().describe("要新增或修改的品項；已在採購單上的產品只改有填的欄位，單價不變時不用填"),
      remove_product_ids: z.array(z.string().uuid()).optional().describe("要從採購單移除的產品 UUID"),
      factory_id: refInput("工廠名稱或 UUID").optional(),
      order_ids: z.array(refInput("訂單編號或 UUID")).optional().describe("完整的關聯銷售訂單列表，取代現有的"),
      order_date: z.string().optional().describe("下單日期，格式 YYYY-MM-DD"),
      expected_arrival_date: z.string().optional().describe("預計到貨日期，格式 YYYY-MM-DD；空字串清除"),
      note: z.string().optional().describe("備註；空字串清除"),
    }),
    rpc: "update_purchase_order",
    toParams: async ({ purchase_order_id, set_items, remove_product_ids, ...changes }, ctx) => {
      let items: Record<string, unknown>[] | undefined;
      if (set_items?.length || remove_product_ids?.length) {
        const merged = await mergeLines(ctx, {
          parentTable: "purchase_orders", parentId: purchase_order_id, notFound: "找不到此採購單",
          table: "purchase_order_items", parentColumn: "purchase_order_id", key: "product_id", parentLabel: "採購單", naming: PRODUCT_NAMING,
          columns: ["id", "product_id", "ordered_quantity", "ordered_rolls", "unit_price", "specifications"],
        }, { upsert: set_items, remove: remove_product_ids }, { ordered_quantity: "訂購數量", unit_price: "單價" });
        if (!Array.isArray(merged)) return merged;
        items = merged;
      }
      return { p_purchase_order_id: purchase_order_id, p_changes: compact({ items, ...changes }) };
    },
  }),

  defineApiWriteTool({
    name: "cancel_purchase_order",
    domain: "purchase",
    permission: "canEditPurchases",
    refs: { purchase_order_id: "purchase_order" },
    description: "取消採購單；已有入庫紀錄時不能取消",
    input: z.object({
      purchase_order_id: refInput("採購單號或 UUID"),
      reason: z.string().optional().describe("取消原因；使用者沒說就不要填"),
    }),
    rpc: "cancel_purchase_order",
    toParams: (i) => ({ p_purchase_order_id: i.purchase_order_id, p_reason: i.reason }),
  }),
];
