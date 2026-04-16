import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export function registerShippingTools(server: McpServer, supabase: SupabaseClient) {
  server.tool(
    "list_shippings",
    "列出出貨記錄，顯示出貨單號、客戶和出貨日期。可依訂單或客戶篩選。適合查詢出貨歷史和追蹤配送狀態。",
    {
      order_id: z
        .string()
        .uuid()
        .optional()
        .describe("訂單 UUID，查詢特定訂單的所有出貨記錄"),
      customer_id: z
        .string()
        .uuid()
        .optional()
        .describe("客戶 UUID，查詢特定客戶的出貨記錄"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("回傳筆數，預設 20"),
    },
    async ({ order_id, customer_id, limit }) => {
      let query = supabase
        .from("shippings")
        .select(
          `id, shipping_number, shipping_date, total_shipped_rolls, total_shipped_quantity, note, created_at,
           customers(name, contact_person),
           orders(order_number)`
        )
        .order("shipping_date", { ascending: false })
        .limit(limit);

      if (order_id) query = query.eq("order_id", order_id);
      if (customer_id) query = query.eq("customer_id", customer_id);

      const { data, error } = await query;
      if (error)
        return {
          content: [{ type: "text", text: `查詢出貨記錄失敗：${error.message}` }],
        };
      if (!data?.length)
        return { content: [{ type: "text", text: "沒有符合條件的出貨記錄" }] };

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_shipping",
    "取得單一出貨單的完整詳情，包含出貨品項和庫存卷號。需要出貨單 UUID。",
    {
      shipping_id: z.string().uuid().describe("出貨單 UUID"),
    },
    async ({ shipping_id }) => {
      const { data, error } = await supabase
        .from("shippings")
        .select(
          `*,
           customers(name, contact_person, phone),
           orders(order_number, status),
           shipping_items(
             id, shipped_quantity,
             inventory_rolls(roll_number, grade, quantity, products_new(name, color))
           )`
        )
        .eq("id", shipping_id)
        .single();

      if (error)
        return {
          content: [
            {
              type: "text",
              text: `找不到出貨單 ${shipping_id}：${error.message}`,
            },
          ],
        };

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
