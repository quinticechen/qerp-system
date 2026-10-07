import { z } from "zod";
import { defineTool, ok, fail } from "./types.js";
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
    execute: async ({ supabase }, { search, limit }) => {
      const q = supabase.from("customers").select("id, name, contact_person, phone, email, address").order("name").limit(limit ?? 20);
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
    execute: async ({ supabase }, { customer_id }) => {
      const { data, error } = await supabase.from("customers").select("*").eq("id", customer_id).single();
      if (error) return fail(`找不到客戶：${error.message}`);
      return ok(data);
    },
  }),

  defineTool({
    name: "create_customer",
    domain: "customer",
    kind: "write",
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
    execute: async ({ supabase, organizationId }, { name, contact_person, phone, landline_phone, fax, email, address, note }) => {
      if (!phone && !landline_phone) return fail("建立失敗：手機或市話至少填一個");
      const { data, error } = await supabase.from("customers").insert({
        name, contact_person, organization_id: organizationId,
        phone: phone ?? null, landline_phone: landline_phone ?? null, fax: fax ?? null,
        email: email ?? null, address: address ?? null, note: note ?? null,
      }).select().single();
      if (error) return fail(`建立失敗：${error.message}`);
      return ok({ message: "客戶建立成功", customer: data });
    },
  }),
];
