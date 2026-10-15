import { z } from "zod";
import { refInput } from "./refs.js";
import { defineTool, ok, fail } from "./types.js";
import { compact, defineApiWriteTool } from "./api.js";
import { applySearch } from "./search.js";

// Shelves are stored in `warehouses` (the receiving screen calls them 倉庫; docs/API.md §3 A6 貨架).
export const shelfTools = [
  defineTool({
    name: "list_shelves",
    domain: "shelf",
    kind: "read",
    permission: "canViewShelves",
    description: "列出貨架，可搜尋名稱或位置；入庫只能放在啟用中的貨架",
    input: z.object({
      search: z.string().optional(),
      include_inactive: z.boolean().optional().describe("是否包含已停用的貨架，預設否"),
    }),
    execute: async ({ supabase, organizationId }, { search, include_inactive }) => {
      let q = supabase.from("warehouses").select("id, name, location, is_active").eq("organization_id", organizationId).order("name").limit(50);
      if (!include_inactive) q = q.eq("is_active", true);
      const { data, error } = await applySearch(q, ["name", "location"], search);
      if (error) return fail(`查詢失敗：${error.message}`);
      return ok(data ?? []);
    },
  }),

  defineApiWriteTool({
    name: "create_shelf",
    domain: "shelf",
    permission: "canCreateShelves",
    description: "建立新貨架",
    input: z.object({
      name: z.string().min(1).describe("貨架名稱"),
      location: z.string().optional().describe("位置"),
    }),
    rpc: "create_shelf",
    toParams: (i) => ({ p_name: i.name, p_location: i.location }),
  }),

  defineApiWriteTool({
    name: "update_shelf",
    domain: "shelf",
    permission: "canEditShelves",
    refs: { shelf_id: "shelf" },
    description: "修改貨架名稱或位置",
    input: z.object({
      shelf_id: refInput("貨架名稱或 UUID"),
      name: z.string().optional().describe("貨架名稱"),
      location: z.string().optional().describe("位置；空字串清除"),
    }),
    rpc: "update_shelf",
    toParams: ({ shelf_id, ...changes }) => ({ p_shelf_id: shelf_id, p_changes: compact(changes) }),
  }),

  defineApiWriteTool({
    name: "set_shelf_active",
    domain: "shelf",
    permission: "canEditShelves",
    refs: { shelf_id: "shelf" },
    description: "停用或重新啟用貨架；停用後不能再放入新布卷",
    input: z.object({
      shelf_id: refInput("貨架名稱或 UUID"),
      is_active: z.boolean().describe("true 啟用、false 停用"),
    }),
    rpc: "set_shelf_active",
    toParams: (i) => ({ p_shelf_id: i.shelf_id, p_is_active: i.is_active }),
  }),
];
