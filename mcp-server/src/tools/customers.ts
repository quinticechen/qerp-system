import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export function registerCustomerTools(server: McpServer, supabase: SupabaseClient) {
  server.tool(
    "list_customers",
    "列出所有客戶。可用關鍵字搜尋客戶名稱或聯絡人。適合查詢客戶資料或建立訂單前確認客戶 ID。",
    {
      search: z
        .string()
        .optional()
        .describe("搜尋關鍵字，比對客戶名稱或聯絡人姓名"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("回傳筆數，預設 20，最多 100"),
    },
    async ({ search, limit }) => {
      let query = supabase
        .from("customers")
        .select("id, name, contact_person, phone, email, address, note")
        .order("name")
        .limit(limit);

      if (search)
        query = query.or(
          `name.ilike.%${search}%,contact_person.ilike.%${search}%`
        );

      const { data, error } = await query;
      if (error)
        return {
          content: [{ type: "text", text: `查詢客戶失敗：${error.message}` }],
        };
      if (!data?.length)
        return { content: [{ type: "text", text: "沒有找到符合條件的客戶" }] };

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_customer",
    "取得單一客戶的完整資料，包含聯絡資訊和備註。需要客戶 UUID。",
    {
      customer_id: z.string().uuid().describe("客戶的 UUID"),
    },
    async ({ customer_id }) => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customer_id)
        .single();

      if (error)
        return {
          content: [{ type: "text", text: `找不到客戶 ${customer_id}：${error.message}` }],
        };

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "create_customer",
    "建立新客戶資料。至少需要客戶名稱和聯絡人，手機或市話至少填一個。",
    {
      name: z.string().min(1).describe("客戶公司名稱"),
      contact_person: z.string().min(1).describe("主要聯絡人姓名"),
      phone: z.string().optional().describe("手機號碼（手機或市話至少填一個）"),
      landline_phone: z.string().optional().describe("市話號碼（手機或市話至少填一個）"),
      email: z.string().email().optional().describe("電子郵件"),
      fax: z.string().optional().describe("傳真號碼"),
      address: z.string().optional().describe("公司地址"),
      note: z.string().optional().describe("備註"),
    },
    async ({ name, contact_person, phone, landline_phone, email, fax, address, note }) => {
      if (!phone && !landline_phone) {
        return {
          content: [{ type: "text", text: "建立失敗：手機（phone）或市話（landline_phone）至少填一個" }],
        };
      }

      const { data, error } = await supabase
        .from("customers")
        .insert({
          name,
          contact_person,
          phone: phone || null,
          landline_phone: landline_phone || null,
          email: email || null,
          fax: fax || null,
          address: address || null,
          note: note || null,
        })
        .select()
        .single();

      if (error)
        return {
          content: [{ type: "text", text: `建立客戶失敗：${error.message}` }],
        };

      return {
        content: [{ type: "text", text: `客戶建立成功：\n${JSON.stringify(data, null, 2)}` }],
      };
    }
  );
}
