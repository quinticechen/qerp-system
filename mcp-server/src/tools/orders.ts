import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const orderStatusEnum = z.enum([
  "pending",
  "confirmed",
  "factory_ordered",
  "completed",
  "cancelled",
]);

const paymentStatusEnum = z.enum(["unpaid", "partial_paid", "paid"]);
const shippingStatusEnum = z.enum(["not_started", "partial_shipped", "shipped"]);

export function registerOrderTools(server: McpServer, supabase: SupabaseClient) {
  server.tool(
    "list_orders",
    "列出銷售訂單列表，包含客戶名稱和基本狀態。可依訂單狀態、付款狀態或客戶 ID 篩選。適合查詢待處理訂單或追蹤特定客戶的訂單進度。",
    {
      status: orderStatusEnum
        .optional()
        .describe(
          "訂單狀態篩選。pending=待確認, confirmed=已確認, factory_ordered=已下工廠, completed=已完成, cancelled=已取消"
        ),
      payment_status: paymentStatusEnum
        .optional()
        .describe("付款狀態篩選。unpaid=未付, partial_paid=部分付款, paid=已付清"),
      customer_id: z
        .string()
        .uuid()
        .optional()
        .describe("客戶 UUID，篩選特定客戶的所有訂單"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("回傳筆數，預設 20"),
    },
    async ({ status, payment_status, customer_id, limit }) => {
      let query = supabase
        .from("orders")
        .select(
          `id, order_number, status, payment_status, shipping_status, note, created_at,
           customers(name, contact_person)`
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (status) query = query.eq("status", status);
      if (payment_status) query = query.eq("payment_status", payment_status);
      if (customer_id) query = query.eq("customer_id", customer_id);

      const { data, error } = await query;
      if (error)
        return { content: [{ type: "text", text: `查詢訂單失敗：${error.message}` }] };
      if (!data?.length)
        return { content: [{ type: "text", text: "沒有符合條件的訂單" }] };

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_order",
    "取得單一訂單的完整詳情，包含訂單品項、指派工廠和出貨狀態。需要訂單 UUID。",
    {
      order_id: z.string().uuid().describe("訂單的 UUID"),
    },
    async ({ order_id }) => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          `*,
           customers(name, contact_person, phone, email),
           order_products(*, products_new(name, color, category)),
           order_factories(*, factories(name))`
        )
        .eq("id", order_id)
        .single();

      if (error)
        return {
          content: [{ type: "text", text: `找不到訂單 ${order_id}：${error.message}` }],
        };

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "create_order",
    "建立新的銷售訂單。需要先知道客戶 ID（可用 list_customers 查詢）。建立後可再用 add_order_product 新增品項。",
    {
      customer_id: z.string().uuid().describe("客戶 UUID，可用 list_customers 查詢"),
      note: z.string().optional().describe("訂單備註"),
    },
    async ({ customer_id, note }) => {
      // 產生訂單編號
      const orderNumber = `ORD-${Date.now()}`;

      const { data, error } = await supabase
        .from("orders")
        .insert({
          order_number: orderNumber,
          customer_id,
          status: "pending",
          payment_status: "unpaid",
          shipping_status: "not_started",
          note: note || null,
        })
        .select(`*, customers(name)`)
        .single();

      if (error)
        return { content: [{ type: "text", text: `建立訂單失敗：${error.message}` }] };

      return {
        content: [
          {
            type: "text",
            text: `訂單建立成功！\n訂單編號：${data.order_number}\n客戶：${(data as any).customers?.name}\n狀態：待確認\n\n可用 add_order_product 新增訂單品項。`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_order_status",
    "更新訂單的狀態、付款狀態或出貨狀態。適合在訂單流程中推進狀態（確認訂單、標記付款、更新出貨進度）。",
    {
      order_id: z.string().uuid().describe("訂單 UUID"),
      status: orderStatusEnum
        .optional()
        .describe("新的訂單狀態。pending→confirmed→factory_ordered→completed"),
      payment_status: paymentStatusEnum
        .optional()
        .describe("付款狀態。unpaid=未付, partial_paid=部分付款, paid=已付清"),
      shipping_status: shippingStatusEnum
        .optional()
        .describe("出貨狀態。not_started=未出貨, partial_shipped=部分出貨, shipped=已全數出貨"),
    },
    async ({ order_id, status, payment_status, shipping_status }) => {
      const updates: Record<string, string> = {};
      if (status) updates.status = status;
      if (payment_status) updates.payment_status = payment_status;
      if (shipping_status) updates.shipping_status = shipping_status;

      if (Object.keys(updates).length === 0) {
        return {
          content: [{ type: "text", text: "請至少指定一個要更新的狀態欄位" }],
        };
      }

      const { data, error } = await supabase
        .from("orders")
        .update(updates)
        .eq("id", order_id)
        .select()
        .single();

      if (error)
        return { content: [{ type: "text", text: `更新訂單失敗：${error.message}` }] };

      return {
        content: [
          {
            type: "text",
            text: `訂單 ${data.order_number} 已更新：\n${JSON.stringify(updates, null, 2)}`,
          },
        ],
      };
    }
  );
}
