import { z } from "zod";
import { refInput } from "./refs.js";
import { allInOrganization, defineTool, ok, fail, type ToolContext } from "./types.js";
import { compact, defineApiWriteTool, refuse, type Refusal } from "./api.js";
import { PRODUCT_NAMING } from "./line-items.js";
import { applySearch, searchNameColor, searchTokens } from "./search.js";

const QUALITY = z.enum(["A", "B", "C", "D", "defective"]);

/**
 * Ids of this organization's receiving batches. inventory_rolls has no organization_id; a roll
 * belongs to the organization of its batch (inventories).
 */
async function batchIds(ctx: ToolContext): Promise<string[] | null> {
  const { data, error } = await ctx.supabase.from("inventories").select("id").eq("organization_id", ctx.organizationId);
  return error ? null : ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * The product a roll without one is for: the purchase order's only product (「P202610100001 要辦入庫」
 * then 「那卷布重 20.5」). With several, the model is told which there are.
 */
async function onlyProductOnPurchaseOrder(ctx: ToolContext, purchaseOrderId: string): Promise<string | Refusal> {
  if (!(await allInOrganization(ctx, "purchase_orders", [purchaseOrderId]))) return refuse("找不到此採購單");
  const { data, error } = await ctx.supabase.from("purchase_order_items").select("product_id, products_new(name, color)").eq("purchase_order_id", purchaseOrderId);
  if (error) return refuse("系統暫時無法完成這項操作，請稍後再試");
  const items = (data ?? []) as unknown as { product_id: string; products_new?: Record<string, unknown> | null }[];
  const products = [...new Map(items.map((i) => [i.product_id, i])).values()];
  if (products.length === 1) return products[0].product_id;
  if (!products.length) return refuse("此採購單沒有任何品項");
  const names = products.map((p, n) => (p.products_new ? PRODUCT_NAMING.label(p.products_new) : `第 ${n + 1} 項`));
  return refuse(`此採購單有 ${products.length} 個產品：${names.join("、")}。請使用者指定每卷布是哪個產品`);
}

export const receivingTools = [
  defineTool({
    name: "list_receivings",
    domain: "receiving",
    kind: "read",
    permission: "canViewInventory",
    refs: { purchase_order_id: "purchase_order" },
    description: "列出進貨單（入庫紀錄），可依採購單篩選",
    input: z.object({
      purchase_order_id: refInput("採購單號或 UUID").optional(),
      limit: z.number().optional(),
    }),
    execute: async ({ supabase, organizationId }, { purchase_order_id, limit }) => {
      let q = supabase.from("inventories").select("id, receipt_number, arrival_date, note, purchase_orders(po_number), factories(name)").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(limit ?? 20);
      if (purchase_order_id) q = q.eq("purchase_order_id", purchase_order_id);
      const { data, error } = await q;
      if (error) return fail(`查詢失敗：${error.message}`);
      return ok(data ?? []);
    },
  }),

  defineTool({
    name: "list_inventory_rolls",
    domain: "inventory",
    kind: "read",
    permission: "canViewInventory",
    description: "列出還有庫存的布卷（卷號、剩餘公斤、品質、貨架），可依產品名稱、顏色或貨架篩選；出貨前用來挑選布卷",
    input: z.object({
      search: z.string().optional().describe("產品名稱或顏色"),
      product_id: z.string().uuid().optional().describe("產品 UUID"),
      shelf: z.string().optional().describe("貨架名稱或儲位，例如 A區-01"),
      limit: z.number().optional(),
    }),
    execute: async (ctx, { search, product_id, shelf, limit }) => {
      const batches = await batchIds(ctx);
      if (!batches) return fail("查詢失敗");
      let productIds: string[] | undefined;
      if (search) {
        const { data, error } = await searchNameColor<{ id: string; name: string; color: string }>((term, max) => {
          const pq = ctx.supabase.from("products_new").select("id, name, color").eq("organization_id", ctx.organizationId).limit(max);
          return applySearch(pq, ["name", "color"], term);
        }, search, 100, "name", "color");
        if (error) return fail(`查詢失敗：${error.message}`);
        productIds = data.map((r) => r.id);
      }
      let q = ctx.supabase.from("inventory_rolls").select("id, roll_number, current_quantity, quality, shelf, products_new(name, color), warehouses(name)").in("inventory_id", batches).gt("current_quantity", 0).order("roll_number").limit(limit ?? 30);
      if (product_id) q = q.eq("product_id", product_id);
      if (productIds) q = q.in("product_id", productIds);
      if (shelf) {
        const term = searchTokens(shelf).join("%");
        const { data: shelves, error } = await ctx.supabase.from("warehouses").select("id").eq("organization_id", ctx.organizationId).ilike("name", `%${term}%`);
        if (error) return fail(`查詢失敗：${error.message}`);
        q = q.or([...((shelves ?? []) as { id: string }[]).map((w) => `warehouse_id.eq.${w.id}`), `shelf.ilike.%${term}%`].join(","));
      }
      const { data, error } = await q;
      if (error) return fail(`查詢失敗：${error.message}`);
      return ok(data ?? []);
    },
  }),

  defineApiWriteTool({
    name: "receive_inventory",
    domain: "receiving",
    permission: "canCreateInventory",
    refs: { purchase_order_id: "purchase_order", "rolls[].warehouse_id": "shelf" },
    description: "依採購單入庫布卷，建立進貨單；產品必須在採購單上",
    input: z.object({
      purchase_order_id: refInput("採購單號或 UUID"),
      rolls: z.array(z.object({
        product_id: z.string().uuid().optional().describe("產品 UUID；採購單只有一個產品時可省略"),
        quantity: z.number().positive().describe("每卷重量（公斤）"),
        roll_count: z.number().int().positive().optional().describe("相同重量的卷數，預設 1"),
        warehouse_id: refInput("貨架名稱或 UUID"),
        shelf: z.string().optional().describe("儲位，例如 B-03"),
        quality: QUALITY.optional().describe("品質，預設 A"),
      })).min(1).describe("入庫的布卷"),
      arrival_date: z.string().optional().describe("到貨日期，格式 YYYY-MM-DD，預設今天"),
      note: z.string().optional().describe("備註"),
    }),
    rpc: "receive_inventory",
    toParams: async (i, ctx) => {
      let rolls = i.rolls;
      if (rolls.some((r) => !r.product_id)) {
        const product = await onlyProductOnPurchaseOrder(ctx, i.purchase_order_id);
        if (typeof product !== "string") return product;
        rolls = rolls.map((r) => ({ ...r, product_id: r.product_id ?? product }));
      }
      return {
        p_purchase_order_id: i.purchase_order_id,
        p_rolls: rolls.flatMap(({ roll_count, ...roll }) => Array.from({ length: roll_count ?? 1 }, () => compact(roll))),
        p_arrival_date: i.arrival_date,
        p_note: i.note,
      };
    },
  }),

  defineApiWriteTool({
    name: "update_inventory",
    domain: "receiving",
    permission: "canEditInventory",
    refs: { inventory_id: "receiving" },
    description: "修改進貨單的到貨日期或備註；單一布卷請用 update_inventory_roll",
    input: z.object({
      inventory_id: refInput("進貨單號或 UUID"),
      arrival_date: z.string().optional().describe("到貨日期，格式 YYYY-MM-DD"),
      note: z.string().optional().describe("備註；空字串清除"),
    }),
    rpc: "update_inventory",
    toParams: ({ inventory_id, ...changes }) => ({ p_inventory_id: inventory_id, p_changes: compact(changes) }),
  }),

  defineApiWriteTool({
    name: "update_inventory_roll",
    domain: "inventory",
    permission: "canEditInventory",
    refs: { roll_id: "roll", warehouse_id: "shelf" },
    description: "修改單一布卷的重量、品質、貨架或儲位",
    input: z.object({
      roll_id: refInput("布卷編號或 UUID"),
      quantity: z.number().positive().optional().describe("入庫重量（公斤）"),
      quality: QUALITY.optional().describe("品質"),
      warehouse_id: refInput("貨架名稱或 UUID").optional(),
      shelf: z.string().optional().describe("儲位"),
    }),
    rpc: "update_inventory_roll",
    toParams: ({ roll_id, ...changes }) => ({ p_roll_id: roll_id, p_changes: compact(changes) }),
  }),
];
