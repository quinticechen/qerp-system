import { z } from "zod";
import { defineTool, ok, fail } from "./types.js";
import { applySearch, searchNameColor } from "./search.js";
import { compact, defineApiWriteTool } from "./api.js";

// A product (product_groups) has one or more colors (products_new). Orders, purchases and rolls
// point at a color, which the tools call product_id; product-level tools take its group_id.
const GROUP_ID = z.string().uuid().describe("產品的 group_id（來自 list_products）");

const COLOR = z.object({
  color: z.string().min(1).describe("顏色"),
  color_code: z.string().optional().describe("色號"),
  stock_threshold: z.number().nonnegative().optional().describe("安全庫存（公斤）"),
});

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
      const { data, error } = await searchNameColor((term, max) => {
        let q = supabase.from("products_new").select("id, group_id, name, category, color, color_code, status").eq("organization_id", organizationId).order("name").limit(max);
        if (status) q = q.eq("status", status);
        return applySearch(q, ["name", "color"], term);
      }, search, limit ?? 30, "name", "color");
      if (error) return fail(`查詢失敗：${error.message}`);
      // Stock per color, so 「還有沒有雲朵眠」 is answered with figures (eval: real-inventory-05).
      const ids = data.map((p) => p.id as string);
      const { data: stock } = ids.length
        ? await supabase.from("inventory_summary_enhanced").select("product_id, total_stock").eq("organization_id", organizationId).in("product_id", ids)
        : { data: [] };
      const kg = new Map(((stock ?? []) as { product_id: string; total_stock: number | null }[]).map((r) => [r.product_id, r.total_stock ?? 0]));
      return ok(data.map((p) => ({ ...p, stock_kg: kg.get(p.id as string) ?? 0 })));
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

  defineApiWriteTool({
    name: "create_product",
    domain: "product",
    permission: "canCreateProducts",
    description: "建立新產品，至少一個顏色；已有同名產品時改用 add_product_color",
    input: z.object({
      name: z.string().min(1).describe("產品名稱"),
      colors: z.array(COLOR).min(1).describe("顏色，至少一個"),
      category: z.string().optional().describe("類別，預設「布料」"),
      unit_of_measure: z.string().optional().describe("單位，預設 KG"),
    }),
    rpc: "create_product",
    toParams: (i) => ({ p_name: i.name, p_colors: i.colors.map(compact), p_category: i.category, p_unit_of_measure: i.unit_of_measure }),
  }),

  defineApiWriteTool({
    name: "update_product",
    domain: "product",
    permission: "canEditProducts",
    description: "修改產品的名稱、類別或單位（套用到所有顏色）",
    input: z.object({
      group_id: GROUP_ID,
      name: z.string().optional().describe("產品名稱"),
      category: z.string().optional().describe("類別"),
      unit_of_measure: z.string().optional().describe("單位"),
    }),
    rpc: "update_product",
    toParams: ({ group_id, ...changes }) => ({ p_product_id: group_id, p_changes: compact(changes) }),
  }),

  defineApiWriteTool({
    name: "set_product_active",
    domain: "product",
    permission: "canEditProducts",
    description: "停用或重新啟用整個產品（含所有顏色）；停用後不能再加入訂單",
    input: z.object({
      group_id: GROUP_ID,
      is_active: z.boolean().describe("true 啟用、false 停用"),
    }),
    rpc: "set_product_active",
    toParams: (i) => ({ p_product_id: i.group_id, p_is_active: i.is_active }),
  }),

  defineApiWriteTool({
    name: "add_product_color",
    domain: "product",
    permission: "canCreateProducts",
    description: "在既有產品下新增顏色",
    input: z.object({
      group_id: GROUP_ID,
      ...COLOR.shape,
    }),
    rpc: "add_product_color",
    toParams: (i) => ({ p_product_id: i.group_id, p_color: i.color, p_color_code: i.color_code, p_stock_threshold: i.stock_threshold }),
  }),

  defineApiWriteTool({
    name: "update_product_color",
    domain: "product",
    permission: "canEditProducts",
    description: "修改單一顏色的名稱、色號或安全庫存",
    input: z.object({
      product_id: z.string().uuid().describe("產品（顏色）UUID"),
      color: z.string().optional().describe("顏色"),
      color_code: z.string().optional().describe("色號；空字串清除"),
      stock_threshold: z.number().nonnegative().optional().describe("安全庫存（公斤）"),
    }),
    rpc: "update_product_color",
    toParams: ({ product_id, ...changes }) => ({ p_color_id: product_id, p_changes: compact(changes) }),
  }),

  defineApiWriteTool({
    name: "set_product_color_active",
    domain: "product",
    permission: "canEditProducts",
    description: "停用或重新啟用單一顏色",
    input: z.object({
      product_id: z.string().uuid().describe("產品（顏色）UUID"),
      is_active: z.boolean().describe("true 啟用、false 停用"),
    }),
    rpc: "set_product_color_active",
    toParams: (i) => ({ p_color_id: i.product_id, p_is_active: i.is_active }),
  }),
];
