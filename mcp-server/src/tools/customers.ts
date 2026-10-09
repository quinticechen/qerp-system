import { z } from "zod";
import { defineTool, ok, fail } from "./types.js";
import { defineApiWriteTool } from "./api.js";
import { applySearch } from "./search.js";

export const customerTools = [
  defineTool({
    name: "list_customers",
    domain: "customer",
    kind: "read",
    permission: "canViewCustomers",
    description: "列出客戶列表，可用關鍵字搜尋名稱或聯絡人",
    input: z.object({
      search: z.string().optional().describe("搜尋關鍵字"),
      limit: z.number().optional().describe("回傳筆數，預設 20"),
    }),
    execute: async ({ supabase, organizationId }, { search, limit }) => {
      const q = supabase.from("customers").select("id, name, contact_person, phone, email, address").eq("organization_id", organizationId).order("name").limit(limit ?? 20);
      const { data, error } = await applySearch(q, ["name", "contact_person"], search);
      if (error) return fail(`查詢失敗：${error.message}`);
      return ok(data ?? []);
    },
  }),

  defineTool({
    name: "get_customer",
    domain: "customer",
    kind: "read",
    permission: "canViewCustomers",
    description: "取得單一客戶完整資料",
    input: z.object({
      customer_id: z.string().uuid().describe("客戶 UUID"),
    }),
    execute: async ({ supabase, organizationId }, { customer_id }) => {
      const { data, error } = await supabase.from("customers").select("*").eq("id", customer_id).eq("organization_id", organizationId).single();
      if (error) return fail(`找不到客戶：${error.message}`);
      return ok(data);
    },
  }),

  defineApiWriteTool({
    name: "create_customer",
    domain: "customer",
    permission: "canCreateCustomers",
    description: "建立新客戶，手機或市話至少填一個",
    input: z.object({
      name: z.string().min(1).describe("公司名稱"),
      contact_person: z.string().min(1).describe("聯絡人姓名"),
      phone: z.string().optional().describe("手機"),
      landline_phone: z.string().optional().describe("市話"),
      fax: z.string().optional().describe("傳真"),
      email: z.string().email().optional().describe("電子郵件"),
      address: z.string().optional().describe("地址"),
      note: z.string().optional().describe("備註"),
    }),
    rpc: "create_customer",
    toParams: (i) => ({
      p_name: i.name, p_contact_person: i.contact_person, p_phone: i.phone, p_landline_phone: i.landline_phone,
      p_fax: i.fax, p_email: i.email, p_address: i.address, p_note: i.note,
    }),
  }),
];
