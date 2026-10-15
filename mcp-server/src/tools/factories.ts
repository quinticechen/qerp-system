import { z } from "zod";
import { refInput } from "./refs.js";
import { defineTool, ok, fail } from "./types.js";
import { compact, defineApiWriteTool } from "./api.js";
import { applySearch } from "./search.js";
import { CONTACT_CHANGES } from "./customers.js";

export const factoryTools = [
  defineTool({
    name: "list_factories",
    domain: "factory",
    kind: "read",
    permission: "canViewFactories",
    description: "列出工廠資料，可搜尋名稱或聯絡人",
    input: z.object({
      search: z.string().optional(),
      limit: z.number().optional(),
    }),
    execute: async ({ supabase, organizationId }, { search, limit }) => {
      const q = supabase.from("factories").select("id, name, contact_person, phone, email").eq("organization_id", organizationId).order("name").limit(limit ?? 20);
      const { data, error } = await applySearch(q, ["name", "contact_person"], search);
      if (error) return fail(`查詢失敗：${error.message}`);
      return ok(data ?? []);
    },
  }),

  defineApiWriteTool({
    name: "create_factory",
    domain: "factory",
    permission: "canCreateFactories",
    description: "建立新工廠，手機或市話至少填一個",
    input: z.object({
      name: z.string().min(1).describe("工廠名稱"),
      contact_person: z.string().min(1).describe("聯絡人姓名"),
      phone: z.string().optional().describe("手機"),
      landline_phone: z.string().optional().describe("市話"),
      fax: z.string().optional().describe("傳真"),
      email: z.string().email().optional().describe("電子郵件"),
      address: z.string().optional().describe("地址"),
      note: z.string().optional().describe("備註"),
    }),
    rpc: "create_factory",
    toParams: (i) => ({
      p_name: i.name, p_contact_person: i.contact_person, p_phone: i.phone, p_landline_phone: i.landline_phone,
      p_fax: i.fax, p_email: i.email, p_address: i.address, p_note: i.note,
    }),
  }),

  defineApiWriteTool({
    name: "update_factory",
    domain: "factory",
    permission: "canEditFactories",
    refs: { factory_id: "factory" },
    description: "修改工廠資料，只填要改的欄位",
    input: z.object({
      factory_id: refInput("工廠名稱或 UUID"),
      ...CONTACT_CHANGES,
    }),
    rpc: "update_factory",
    toParams: ({ factory_id, ...changes }) => ({ p_factory_id: factory_id, p_changes: compact(changes) }),
  }),

  defineApiWriteTool({
    name: "set_factory_active",
    domain: "factory",
    permission: "canEditFactories",
    refs: { factory_id: "factory" },
    description: "停用或重新啟用工廠；停用的工廠不能再用於新的訂單或採購單",
    input: z.object({
      factory_id: refInput("工廠名稱或 UUID"),
      is_active: z.boolean().describe("true 啟用、false 停用"),
    }),
    rpc: "set_factory_active",
    toParams: (i) => ({ p_factory_id: i.factory_id, p_is_active: i.is_active }),
  }),
];
