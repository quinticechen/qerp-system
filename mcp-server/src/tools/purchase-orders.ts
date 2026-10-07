import { z } from "zod";
import { defineTool, ok, fail, embeddedName } from "./types.js";

export const purchaseOrderTools = [
  defineTool({
    name: "list_purchase_orders",
    domain: "purchase",
    kind: "read",
    permission: "canViewPurchases",
    description: "列出採購單，可依狀態或工廠篩選",
    input: z.object({
      status: z.enum(["pending", "confirmed", "in_production", "completed", "cancelled"]).optional(),
      factory_id: z.string().uuid().optional(),
      limit: z.number().optional(),
    }),
    execute: async ({ supabase }, { status, factory_id, limit }) => {
      let q = supabase.from("purchase_orders").select("id, po_number, status, order_date, expected_arrival_date, factories(name)").order("created_at", { ascending: false }).limit(limit ?? 20);
      if (status) q = q.eq("status", status);
      if (factory_id) q = q.eq("factory_id", factory_id);
      const { data, error } = await q;
      if (error) return fail(`查詢失敗：${error.message}`);
      return ok(data ?? []);
    },
  }),

  defineTool({
    name: "get_purchase_order",
    domain: "purchase",
    kind: "read",
    permission: "canViewPurchases",
    description: "取得採購單完整詳情含品項",
    input: z.object({
      purchase_order_id: z.string().uuid().describe("採購單 UUID"),
    }),
    execute: async ({ supabase }, { purchase_order_id }) => {
      const { data, error } = await supabase.from("purchase_orders").select("*, factories(name, contact_person, phone), purchase_order_items(*, products_new(name, color))").eq("id", purchase_order_id).single();
      if (error) return fail(`找不到採購單：${error.message}`);
      return ok(data);
    },
  }),

  defineTool({
    name: "create_purchase_order",
    domain: "purchase",
    kind: "write",
    permission: "canCreatePurchases",
    description: "建立新採購單，需指定工廠與至少一項品項（產品、數量、單價）。可選擇關聯既有銷售訂單，關聯後該訂單狀態會自動更新為「已向工廠下單」。",
    input: z.object({
      factory_id: z.string().uuid().describe("工廠 UUID"),
      expected_arrival_date: z.string().optional().describe("預計到貨日期，格式 YYYY-MM-DD"),
      note: z.string().optional().describe("備註"),
      items: z.array(z.object({
        product_id: z.string().uuid().describe("產品 UUID"),
        ordered_quantity: z.number().positive().describe("訂購數量"),
        unit_price: z.number().positive().describe("單價"),
        specifications: z.string().optional().describe("規格說明，例如顏色、尺寸等備註"),
      })).min(1).describe("採購品項列表，至少一筆"),
      order_ids: z.array(z.string().uuid()).optional().describe("要關聯的銷售訂單 UUID 列表"),
    }),
    // Not transactional: a later step can fail after the header row is written. Moves to an
    // RPC in the Phase 1 order flow (docs/QUERY_AGENT_PHASE0.md D1).
    execute: async ({ supabase, userId, organizationId }, { factory_id, expected_arrival_date, note, items, order_ids }) => {
      const { data: purchase, error: purchaseError } = await supabase.from("purchase_orders").insert({
        factory_id,
        expected_arrival_date: expected_arrival_date ?? null,
        note: note ?? null,
        status: "confirmed",
        user_id: userId,
        organization_id: organizationId,
      }).select("id, po_number, factories(name)").single();
      if (purchaseError) return fail(`建立失敗：${purchaseError.message}`);

      const po = purchase;
      const { error: itemsError } = await supabase.from("purchase_order_items").insert(items.map((item) => ({
        purchase_order_id: po.id,
        product_id: item.product_id,
        ordered_quantity: item.ordered_quantity,
        ordered_rolls: 0,
        unit_price: item.unit_price,
        specifications: item.specifications ? { description: item.specifications } : null,
      })));
      if (itemsError) return fail(`採購單已建立（編號 ${po.po_number}），但品項新增失敗：${itemsError.message}`);

      if (order_ids?.length) {
        const { error: relError } = await supabase.from("purchase_order_relations").insert(
          order_ids.map((order_id) => ({ purchase_order_id: po.id, order_id }))
        );
        if (relError) return fail(`採購單已建立（編號 ${po.po_number}），但關聯訂單失敗：${relError.message}`);
        await supabase.from("orders").update({ status: "factory_ordered" }).in("id", order_ids);
      }

      return ok({
        message: "採購單建立成功",
        po_number: po.po_number,
        factory: embeddedName(po.factories),
        item_count: items.length,
        linked_order_count: order_ids?.length ?? 0,
      });
    },
  }),
];
