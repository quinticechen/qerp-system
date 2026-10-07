import { z } from "zod";
import { defineTool, ok, fail } from "./types.js";
import { applySearch } from "./search.js";

interface StockRow {
  total_stock: number | null;
  stock_thresholds: number | null;
}

export const inventoryTools = [
  defineTool({
    name: "get_inventory_summary",
    domain: "inventory",
    kind: "read",
    permission: "canViewInventory",
    description: "查詢庫存，顯示 A/B/C/D 級及瑕疵品數量和卷數",
    input: z.object({
      product_id: z.string().uuid().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    }),
    execute: async ({ supabase }, { product_id, search, limit }) => {
      let q = supabase.from("inventory_summary_enhanced").select("product_id, product_name, color, total_stock, total_rolls, a_grade_stock, b_grade_stock, c_grade_stock, d_grade_stock, defective_stock, stock_thresholds").limit(limit ?? 30);
      if (product_id) q = q.eq("product_id", product_id);
      const { data, error } = await applySearch(q, ["product_name", "color"], search);
      if (error) return fail(`查詢失敗：${error.message}`);
      return ok(data ?? []);
    },
  }),

  defineTool({
    name: "get_low_stock_alerts",
    domain: "inventory",
    kind: "read",
    permission: "canViewInventory",
    description: "取得庫存低於門檻的產品警示清單",
    input: z.object({}),
    execute: async ({ supabase }) => {
      const { data, error } = await supabase.from("inventory_summary_enhanced").select("product_id, product_name, color, total_stock, stock_thresholds").eq("product_status", "Available").not("stock_thresholds", "is", null);
      if (error) return fail(`查詢失敗：${error.message}`);
      const low = ((data ?? []) as StockRow[]).filter((i) => i.stock_thresholds && (i.total_stock ?? 0) < i.stock_thresholds);
      return ok(low.length ? low : "目前所有產品庫存充足");
    },
  }),
];
