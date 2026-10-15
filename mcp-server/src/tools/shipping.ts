import { z } from "zod";
import { refInput } from "./refs.js";
import { defineTool, ok, fail } from "./types.js";
import { compact, defineApiWriteTool } from "./api.js";
import { mergeLines } from "./line-items.js";

export const shippingTools = [
  defineTool({
    name: "list_shippings",
    domain: "shipping",
    kind: "read",
    permission: "canViewShipping",
    refs: { order_id: "order", customer_id: "customer" },
    description: "列出出貨記錄，可依訂單或客戶篩選",
    input: z.object({
      order_id: refInput("訂單編號或 UUID").optional(),
      customer_id: refInput("客戶名稱或 UUID").optional(),
      limit: z.number().optional(),
    }),
    execute: async ({ supabase, organizationId }, { order_id, customer_id, limit }) => {
      let q = supabase.from("shippings").select("id, shipping_number, status, shipping_date, total_shipped_rolls, total_shipped_quantity, customers(name), orders(order_number)").eq("organization_id", organizationId).order("shipping_date", { ascending: false }).limit(limit ?? 20);
      if (order_id) q = q.eq("order_id", order_id);
      if (customer_id) q = q.eq("customer_id", customer_id);
      const { data, error } = await q;
      if (error) return fail(`查詢失敗：${error.message}`);
      return ok(data ?? []);
    },
  }),

  defineTool({
    name: "get_shipping",
    domain: "shipping",
    kind: "read",
    permission: "canViewShipping",
    refs: { shipping_id: "shipping" },
    description: "取得出貨單完整詳情含卷號",
    input: z.object({
      shipping_id: refInput("出貨單號或 UUID"),
    }),
    execute: async ({ supabase, organizationId }, { shipping_id }) => {
      const { data, error } = await supabase.from("shippings").select("*, customers(name, phone), orders(order_number), shipping_items(id, shipped_quantity, inventory_rolls(roll_number, quality, products_new(name, color)))").eq("id", shipping_id).eq("organization_id", organizationId).single();
      if (error) return fail(`找不到出貨單：${error.message}`);
      return ok(data);
    },
  }),

  defineApiWriteTool({
    name: "create_shipping",
    domain: "shipping",
    permission: "canCreateShipping",
    refs: { order_id: "order", "items[].inventory_roll_id": "roll" },
    description: "依訂單出貨，建立出貨單並扣除布卷庫存；布卷的產品必須在訂單上",
    input: z.object({
      order_id: refInput("訂單編號或 UUID"),
      items: z.array(z.object({
        inventory_roll_id: refInput("布卷編號或 UUID"),
        shipped_quantity: z.number().positive().describe("出貨重量（公斤）"),
      })).min(1).describe("出貨的布卷，至少一卷"),
      shipping_date: z.string().optional().describe("出貨日期，格式 YYYY-MM-DD，預設今天"),
      note: z.string().optional().describe("備註"),
    }),
    rpc: "create_shipping",
    toParams: (i) => ({ p_order_id: i.order_id, p_items: i.items, p_shipping_date: i.shipping_date, p_note: i.note }),
  }),

  defineApiWriteTool({
    name: "update_shipping",
    domain: "shipping",
    permission: "canEditShipping",
    refs: { shipping_id: "shipping", "set_items[].inventory_roll_id": "roll", "remove_roll_ids[]": "roll" },
    description: "修改出貨單的布卷、出貨日期或備註；只列出要新增、修改或移除的布卷",
    input: z.object({
      shipping_id: refInput("出貨單號或 UUID"),
      set_items: z.array(z.object({
        inventory_roll_id: refInput("布卷編號或 UUID"),
        shipped_quantity: z.number().positive().describe("出貨重量（公斤）"),
      })).optional().describe("要新增或修改出貨重量的布卷"),
      remove_roll_ids: z.array(refInput("布卷編號或 UUID")).optional().describe("要從出貨單移除的布卷"),
      shipping_date: z.string().optional().describe("出貨日期，格式 YYYY-MM-DD"),
      note: z.string().optional().describe("備註；空字串清除"),
    }),
    rpc: "update_shipping",
    toParams: async ({ shipping_id, set_items, remove_roll_ids, ...changes }, ctx) => {
      let items: Record<string, unknown>[] | undefined;
      if (set_items?.length || remove_roll_ids?.length) {
        const merged = await mergeLines(ctx, {
          parentTable: "shippings", parentId: shipping_id, notFound: "找不到此出貨單",
          table: "shipping_items", parentColumn: "shipping_id", key: "inventory_roll_id", parentLabel: "出貨單",
          naming: { embed: "inventory_rolls(roll_number)", label: (r) => String(r.roll_number) },
          columns: ["id", "inventory_roll_id", "shipped_quantity"],
        }, { upsert: set_items, remove: remove_roll_ids }, { shipped_quantity: "出貨重量" });
        if (!Array.isArray(merged)) return merged;
        items = merged;
      }
      return { p_shipping_id: shipping_id, p_changes: compact({ items, ...changes }) };
    },
  }),

  defineApiWriteTool({
    name: "cancel_shipping",
    domain: "shipping",
    permission: "canEditShipping",
    refs: { shipping_id: "shipping" },
    description: "取消出貨單，出貨的重量會加回布卷庫存",
    input: z.object({
      shipping_id: refInput("出貨單號或 UUID"),
      reason: z.string().optional().describe("取消原因；使用者沒說就不要填"),
    }),
    rpc: "cancel_shipping",
    toParams: (i) => ({ p_shipping_id: i.shipping_id, p_reason: i.reason }),
  }),
];
