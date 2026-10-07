import { z } from "zod";
import { defineTool, ok, fail } from "./types.js";
import { applySearch } from "./search.js";

export const productTools = [
  defineTool({
    name: "list_products",
    domain: "product",
    kind: "read",
    permission: "canViewProducts",
    description: "列出產品目錄，可依名稱、顏色或狀態篩選",
    input: z.object({
      search: z.string().optional(),
      status: z.enum(["Available", "Unavailable"]).optional(),
      limit: z.number().optional(),
    }),
    execute: async ({ supabase, organizationId }, { search, status, limit }) => {
      let q = supabase.from("products_new").select("id, name, category, color, color_code, status").eq("organization_id", organizationId).order("name").limit(limit ?? 30);
      if (status) q = q.eq("status", status);
      const { data, error } = await applySearch(q, ["name", "color"], search);
      if (error) return fail(`查詢失敗：${error.message}`);
      return ok(data ?? []);
    },
  }),

  defineTool({
    name: "get_product",
    domain: "product",
    kind: "read",
    permission: "canViewProducts",
    description: "取得單一產品完整規格",
    input: z.object({
      product_id: z.string().uuid().describe("產品 UUID"),
    }),
    execute: async ({ supabase, organizationId }, { product_id }) => {
      const { data, error } = await supabase.from("products_new").select("*").eq("id", product_id).eq("organization_id", organizationId).single();
      if (error) return fail(`找不到產品：${error.message}`);
      return ok(data);
    },
  }),
];
