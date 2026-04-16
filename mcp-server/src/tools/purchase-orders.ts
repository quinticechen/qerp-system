import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const poStatusEnum = z.enum([
  "pending",
  "confirmed",
  "in_production",
  "completed",
  "cancelled",
]);

export function registerPurchaseOrderTools(server: McpServer, supabase: SupabaseClient) {
  server.tool(
    "list_purchase_orders",
    "列出採購單列表，顯示工廠名稱和狀態。可依狀態或工廠篩選。適合追蹤工廠生產進度。",
    {
      status: poStatusEnum
        .optional()
        .describe(
          "採購單狀態篩選。pending=待確認, confirmed=已確認, in_production=生產中, completed=已完成, cancelled=已取消"
        ),
      factory_id: z
        .string()
        .uuid()
        .optional()
        .describe("工廠 UUID，篩選特定工廠的採購單"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("回傳筆數，預設 20"),
    },
    async ({ status, factory_id, limit }) => {
      let query = supabase
        .from("purchase_orders")
        .select(
          `id, po_number, status, order_date, expected_arrival_date, note, created_at,
           factories(name, contact_person)`
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (status) query = query.eq("status", status);
      if (factory_id) query = query.eq("factory_id", factory_id);

      const { data, error } = await query;
      if (error)
        return {
          content: [{ type: "text", text: `查詢採購單失敗：${error.message}` }],
        };
      if (!data?.length)
        return { content: [{ type: "text", text: "沒有符合條件的採購單" }] };

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_purchase_order",
    "取得單一採購單的完整詳情，包含品項列表和關聯銷售訂單。需要採購單 UUID。",
    {
      purchase_order_id: z.string().uuid().describe("採購單 UUID"),
    },
    async ({ purchase_order_id }) => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select(
          `*,
           factories(name, contact_person, phone, email),
           purchase_order_items(*, products_new(name, color, category))`
        )
        .eq("id", purchase_order_id)
        .single();

      if (error)
        return {
          content: [
            {
              type: "text",
              text: `找不到採購單 ${purchase_order_id}：${error.message}`,
            },
          ],
        };

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
