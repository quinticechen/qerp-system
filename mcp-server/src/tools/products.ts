import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export function registerProductTools(server: McpServer, supabase: SupabaseClient) {
  server.tool(
    "list_products",
    "列出產品目錄，包含布料名稱、顏色、分類和庫存狀態。適合建立訂單前查詢可用產品及其 ID。",
    {
      search: z
        .string()
        .optional()
        .describe("搜尋關鍵字，比對產品名稱或顏色"),
      status: z
        .enum(["Available", "Unavailable"])
        .optional()
        .describe("狀態篩選。Available=可用, Unavailable=停用。不填回傳全部"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(30)
        .describe("回傳筆數，預設 30"),
    },
    async ({ search, status, limit }) => {
      let query = supabase
        .from("products_new")
        .select("id, name, category, color, color_code, unit_of_measure, status, stock_thresholds")
        .order("name")
        .limit(limit);

      if (status) query = query.eq("status", status);
      if (search)
        query = query.or(`name.ilike.%${search}%,color.ilike.%${search}%`);

      const { data, error } = await query;
      if (error)
        return { content: [{ type: "text", text: `查詢產品失敗：${error.message}` }] };
      if (!data?.length)
        return { content: [{ type: "text", text: "沒有找到符合條件的產品" }] };

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_product",
    "取得單一產品的完整資料，包含規格和庫存門檻設定。",
    {
      product_id: z.string().uuid().describe("產品 UUID"),
    },
    async ({ product_id }) => {
      const { data, error } = await supabase
        .from("products_new")
        .select("*")
        .eq("id", product_id)
        .single();

      if (error)
        return {
          content: [{ type: "text", text: `找不到產品 ${product_id}：${error.message}` }],
        };

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
