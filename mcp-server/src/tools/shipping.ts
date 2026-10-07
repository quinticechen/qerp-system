import { z } from "zod";
import { defineTool, ok, fail } from "./types.js";

export const shippingTools = [
  defineTool({
    name: "list_shippings",
    domain: "shipping",
    kind: "read",
    permission: "canViewShipping",
    description: "列出出貨記錄，可依訂單或客戶篩選",
    input: z.object({
      order_id: z.string().uuid().optional(),
      customer_id: z.string().uuid().optional(),
      limit: z.number().optional(),
    }),
    execute: async ({ supabase }, { order_id, customer_id, limit }) => {
      let q = supabase.from("shippings").select("id, shipping_number, shipping_date, total_shipped_rolls, total_shipped_quantity, customers(name), orders(order_number)").order("shipping_date", { ascending: false }).limit(limit ?? 20);
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
    description: "取得出貨單完整詳情含卷號",
    input: z.object({
      shipping_id: z.string().uuid().describe("出貨單 UUID"),
    }),
    execute: async ({ supabase }, { shipping_id }) => {
      const { data, error } = await supabase.from("shippings").select("*, customers(name, phone), orders(order_number), shipping_items(id, shipped_quantity, inventory_rolls(roll_number, grade, products_new(name, color)))").eq("id", shipping_id).single();
      if (error) return fail(`找不到出貨單：${error.message}`);
      return ok(data);
    },
  }),
];
