import { z } from "zod";
import { defineTool, ok, fail } from "./types.js";
import { applySearch } from "./search.js";

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
];
