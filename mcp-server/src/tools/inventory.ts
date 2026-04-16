import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export function registerInventoryTools(server: McpServer, supabase: SupabaseClient) {
  server.tool(
    "get_inventory_summary",
    "查詢庫存摘要，顯示每個產品的各等級庫存數量（A/B/C/D 級和瑕疵品）及卷數。可按產品 ID 或關鍵字篩選。",
    {
      product_id: z
        .string()
        .uuid()
        .optional()
        .describe("產品 UUID，查詢特定產品庫存"),
      search: z
        .string()
        .optional()
        .describe("搜尋關鍵字，比對產品名稱或顏色"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(30)
        .describe("回傳筆數，預設 30"),
    },
    async ({ product_id, search, limit }) => {
      let query = supabase
        .from("inventory_summary_enhanced")
        .select(
          "product_id, product_name, color, color_code, product_status, total_stock, total_rolls, a_grade_stock, b_grade_stock, c_grade_stock, d_grade_stock, defective_stock, stock_thresholds, pending_in_quantity, pending_out_quantity"
        )
        .limit(limit);

      if (product_id) query = query.eq("product_id", product_id);
      if (search)
        query = query.or(
          `product_name.ilike.%${search}%,color.ilike.%${search}%`
        );

      const { data, error } = await query;
      if (error)
        return {
          content: [{ type: "text", text: `查詢庫存失敗：${error.message}` }],
        };
      if (!data?.length)
        return { content: [{ type: "text", text: "沒有找到符合條件的庫存資料" }] };

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_low_stock_alerts",
    "列出庫存低於門檻的產品警示。適合定期檢查需要補貨的品項。",
    {},
    async () => {
      const { data, error } = await supabase
        .from("inventory_summary_enhanced")
        .select(
          "product_id, product_name, color, color_code, total_stock, stock_thresholds, product_status"
        )
        .eq("product_status", "Available")
        .not("stock_thresholds", "is", null);

      if (error)
        return {
          content: [{ type: "text", text: `查詢庫存警示失敗：${error.message}` }],
        };

      const lowStock = (data || []).filter(
        (item) =>
          item.stock_thresholds !== null &&
          (item.total_stock || 0) < item.stock_thresholds
      );

      if (!lowStock.length)
        return {
          content: [{ type: "text", text: "目前所有產品庫存充足，無需補貨" }],
        };

      return {
        content: [
          {
            type: "text",
            text: `發現 ${lowStock.length} 個產品庫存不足：\n${JSON.stringify(lowStock, null, 2)}`,
          },
        ],
      };
    }
  );
}
