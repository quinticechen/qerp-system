import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export function registerFactoryTools(server: McpServer, supabase: SupabaseClient) {
  server.tool(
    "list_factories",
    "列出所有工廠，包含聯絡資訊。可用關鍵字搜尋工廠名稱或聯絡人。適合下採購單前確認工廠 ID。",
    {
      search: z
        .string()
        .optional()
        .describe("搜尋關鍵字，比對工廠名稱或聯絡人姓名"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("回傳筆數，預設 20"),
    },
    async ({ search, limit }) => {
      let query = supabase
        .from("factories")
        .select("id, name, contact_person, phone, landline_phone, email, address, note")
        .order("name")
        .limit(limit);

      if (search)
        query = query.or(
          `name.ilike.%${search}%,contact_person.ilike.%${search}%`
        );

      const { data, error } = await query;
      if (error)
        return {
          content: [{ type: "text", text: `查詢工廠失敗：${error.message}` }],
        };
      if (!data?.length)
        return { content: [{ type: "text", text: "沒有找到符合條件的工廠" }] };

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
