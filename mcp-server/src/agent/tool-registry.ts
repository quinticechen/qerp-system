/**
 * Tool Registry — Vercel AI SDK 格式的 ERP 工具定義
 *
 * 使用 tool() + Zod schema，execute 函數以 closure 捕捉 supabase client。
 * 透過 createTools(supabase, allowedTools) 取得按權限過濾後的工具集。
 */

import { tool } from "ai";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { ToolName, filterByGroup, AgentGroup } from "./permissions.js";

export function createTools(supabase: SupabaseClient, allowedTools: ToolName[]) {
  const allTools = {
    // ── 客戶管理 ────────────────────────────────────────────────────────────
    list_customers: tool({
      description: "列出客戶列表，可用關鍵字搜尋名稱或聯絡人",
      parameters: z.object({
        search: z.string().optional().describe("搜尋關鍵字"),
        limit: z.number().optional().describe("回傳筆數，預設 20"),
      }),
      execute: async ({ search, limit }) => {
        let q = supabase.from("customers").select("id, name, contact_person, phone, email, address").order("name").limit(limit ?? 20);
        if (search) q = q.or(`name.ilike.%${search}%,contact_person.ilike.%${search}%`);
        const { data, error } = await q;
        if (error) return `查詢失敗：${error.message}`;
        return data ?? [];
      },
    }),

    get_customer: tool({
      description: "取得單一客戶完整資料",
      parameters: z.object({
        customer_id: z.string().uuid().describe("客戶 UUID"),
      }),
      execute: async ({ customer_id }) => {
        const { data, error } = await supabase.from("customers").select("*").eq("id", customer_id).single();
        if (error) return `找不到客戶：${error.message}`;
        return data;
      },
    }),

    create_customer: tool({
      description: "建立新客戶，手機或市話至少填一個",
      parameters: z.object({
        name: z.string().min(1).describe("公司名稱"),
        contact_person: z.string().min(1).describe("聯絡人姓名"),
        phone: z.string().optional().describe("手機"),
        landline_phone: z.string().optional().describe("市話"),
        email: z.string().email().optional().describe("電子郵件"),
        address: z.string().optional().describe("地址"),
        note: z.string().optional().describe("備註"),
      }),
      execute: async ({ name, contact_person, phone, landline_phone, email, address, note }) => {
        if (!phone && !landline_phone) return "建立失敗：手機或市話至少填一個";
        const { data, error } = await supabase.from("customers").insert({
          name, contact_person, phone: phone ?? null, landline_phone: landline_phone ?? null,
          email: email ?? null, address: address ?? null, note: note ?? null,
        }).select().single();
        if (error) return `建立失敗：${error.message}`;
        return `客戶建立成功：${JSON.stringify(data)}`;
      },
    }),

    // ── 訂單管理 ────────────────────────────────────────────────────────────
    list_orders: tool({
      description: "列出銷售訂單，可依狀態、付款狀態或客戶篩選",
      parameters: z.object({
        status: z.enum(["pending", "confirmed", "factory_ordered", "completed", "cancelled"]).optional(),
        payment_status: z.enum(["unpaid", "partial_paid", "paid"]).optional(),
        customer_id: z.string().uuid().optional().describe("客戶 UUID"),
        limit: z.number().optional(),
      }),
      execute: async ({ status, payment_status, customer_id, limit }) => {
        let q = supabase.from("orders").select("id, order_number, status, payment_status, shipping_status, created_at, customers(name)").order("created_at", { ascending: false }).limit(limit ?? 20);
        if (status) q = q.eq("status", status);
        if (payment_status) q = q.eq("payment_status", payment_status);
        if (customer_id) q = q.eq("customer_id", customer_id);
        const { data, error } = await q;
        if (error) return `查詢失敗：${error.message}`;
        return data ?? [];
      },
    }),

    get_order: tool({
      description: "取得訂單完整詳情，含品項和工廠",
      parameters: z.object({
        order_id: z.string().uuid().describe("訂單 UUID"),
      }),
      execute: async ({ order_id }) => {
        const { data, error } = await supabase.from("orders").select("*, customers(name, contact_person, phone), order_products(*, products_new(name, color)), order_factories(*, factories(name))").eq("id", order_id).single();
        if (error) return `找不到訂單：${error.message}`;
        return data;
      },
    }),

    create_order: tool({
      description: "建立新銷售訂單",
      parameters: z.object({
        customer_id: z.string().uuid().describe("客戶 UUID"),
        note: z.string().optional().describe("備註"),
      }),
      execute: async ({ customer_id, note }) => {
        const orderNumber = `ORD-${Date.now()}`;
        const { data, error } = await supabase.from("orders").insert({
          order_number: orderNumber, customer_id, status: "pending",
          payment_status: "unpaid", shipping_status: "not_started", note: note ?? null,
        }).select("*, customers(name)").single();
        if (error) return `建立失敗：${error.message}`;
        return `訂單建立成功！編號：${(data as any).order_number}，客戶：${(data as any).customers?.name}`;
      },
    }),

    update_order_status: tool({
      description: "更新訂單狀態、付款狀態或出貨狀態",
      parameters: z.object({
        order_id: z.string().uuid().describe("訂單 UUID"),
        status: z.enum(["pending", "confirmed", "factory_ordered", "completed", "cancelled"]).optional(),
        payment_status: z.enum(["unpaid", "partial_paid", "paid"]).optional(),
        shipping_status: z.enum(["not_started", "partial_shipped", "shipped"]).optional(),
      }),
      execute: async ({ order_id, status, payment_status, shipping_status }) => {
        const updates: Record<string, string> = {};
        if (status) updates.status = status;
        if (payment_status) updates.payment_status = payment_status;
        if (shipping_status) updates.shipping_status = shipping_status;
        if (!Object.keys(updates).length) return "請至少指定一個要更新的欄位";
        const { data, error } = await supabase.from("orders").update(updates).eq("id", order_id).select().single();
        if (error) return `更新失敗：${error.message}`;
        return `訂單 ${(data as any).order_number} 已更新：${JSON.stringify(updates)}`;
      },
    }),

    // ── 產品管理 ────────────────────────────────────────────────────────────
    list_products: tool({
      description: "列出產品目錄，可依名稱、顏色或狀態篩選",
      parameters: z.object({
        search: z.string().optional(),
        status: z.enum(["Available", "Unavailable"]).optional(),
        limit: z.number().optional(),
      }),
      execute: async ({ search, status, limit }) => {
        let q = supabase.from("products_new").select("id, name, category, color, color_code, status").order("name").limit(limit ?? 30);
        if (status) q = q.eq("status", status);
        if (search) q = q.or(`name.ilike.%${search}%,color.ilike.%${search}%`);
        const { data, error } = await q;
        if (error) return `查詢失敗：${error.message}`;
        return data ?? [];
      },
    }),

    get_product: tool({
      description: "取得單一產品完整規格",
      parameters: z.object({
        product_id: z.string().uuid().describe("產品 UUID"),
      }),
      execute: async ({ product_id }) => {
        const { data, error } = await supabase.from("products_new").select("*").eq("id", product_id).single();
        if (error) return `找不到產品：${error.message}`;
        return data;
      },
    }),

    // ── 庫存管理 ────────────────────────────────────────────────────────────
    get_inventory_summary: tool({
      description: "查詢庫存，顯示 A/B/C/D 級及瑕疵品數量和卷數",
      parameters: z.object({
        product_id: z.string().uuid().optional(),
        search: z.string().optional(),
        limit: z.number().optional(),
      }),
      execute: async ({ product_id, search, limit }) => {
        let q = supabase.from("inventory_summary_enhanced").select("product_id, product_name, color, total_stock, total_rolls, a_grade_stock, b_grade_stock, c_grade_stock, d_grade_stock, defective_stock, stock_thresholds").limit(limit ?? 30);
        if (product_id) q = q.eq("product_id", product_id);
        if (search) q = q.or(`product_name.ilike.%${search}%,color.ilike.%${search}%`);
        const { data, error } = await q;
        if (error) return `查詢失敗：${error.message}`;
        return data ?? [];
      },
    }),

    get_low_stock_alerts: tool({
      description: "取得庫存低於門檻的產品警示清單",
      parameters: z.object({}),
      execute: async () => {
        const { data, error } = await supabase.from("inventory_summary_enhanced").select("product_id, product_name, color, total_stock, stock_thresholds").eq("product_status", "Available").not("stock_thresholds", "is", null);
        if (error) return `查詢失敗：${error.message}`;
        const low = (data ?? []).filter((i: any) => i.stock_thresholds && (i.total_stock ?? 0) < i.stock_thresholds);
        if (!low.length) return "目前所有產品庫存充足";
        return low;
      },
    }),

    // ── 採購單 ──────────────────────────────────────────────────────────────
    list_purchase_orders: tool({
      description: "列出採購單，可依狀態或工廠篩選",
      parameters: z.object({
        status: z.enum(["pending", "confirmed", "in_production", "completed", "cancelled"]).optional(),
        factory_id: z.string().uuid().optional(),
        limit: z.number().optional(),
      }),
      execute: async ({ status, factory_id, limit }) => {
        let q = supabase.from("purchase_orders").select("id, po_number, status, order_date, expected_arrival_date, factories(name)").order("created_at", { ascending: false }).limit(limit ?? 20);
        if (status) q = q.eq("status", status);
        if (factory_id) q = q.eq("factory_id", factory_id);
        const { data, error } = await q;
        if (error) return `查詢失敗：${error.message}`;
        return data ?? [];
      },
    }),

    get_purchase_order: tool({
      description: "取得採購單完整詳情含品項",
      parameters: z.object({
        purchase_order_id: z.string().uuid().describe("採購單 UUID"),
      }),
      execute: async ({ purchase_order_id }) => {
        const { data, error } = await supabase.from("purchase_orders").select("*, factories(name, contact_person, phone), purchase_order_items(*, products_new(name, color))").eq("id", purchase_order_id).single();
        if (error) return `找不到採購單：${error.message}`;
        return data;
      },
    }),

    // ── 出貨管理 ────────────────────────────────────────────────────────────
    list_shippings: tool({
      description: "列出出貨記錄，可依訂單或客戶篩選",
      parameters: z.object({
        order_id: z.string().uuid().optional(),
        customer_id: z.string().uuid().optional(),
        limit: z.number().optional(),
      }),
      execute: async ({ order_id, customer_id, limit }) => {
        let q = supabase.from("shippings").select("id, shipping_number, shipping_date, total_shipped_rolls, total_shipped_quantity, customers(name), orders(order_number)").order("shipping_date", { ascending: false }).limit(limit ?? 20);
        if (order_id) q = q.eq("order_id", order_id);
        if (customer_id) q = q.eq("customer_id", customer_id);
        const { data, error } = await q;
        if (error) return `查詢失敗：${error.message}`;
        return data ?? [];
      },
    }),

    get_shipping: tool({
      description: "取得出貨單完整詳情含卷號",
      parameters: z.object({
        shipping_id: z.string().uuid().describe("出貨單 UUID"),
      }),
      execute: async ({ shipping_id }) => {
        const { data, error } = await supabase.from("shippings").select("*, customers(name, phone), orders(order_number), shipping_items(id, shipped_quantity, inventory_rolls(roll_number, grade, products_new(name, color)))").eq("id", shipping_id).single();
        if (error) return `找不到出貨單：${error.message}`;
        return data;
      },
    }),

    // ── 工廠管理 ────────────────────────────────────────────────────────────
    list_factories: tool({
      description: "列出工廠資料，可搜尋名稱或聯絡人",
      parameters: z.object({
        search: z.string().optional(),
        limit: z.number().optional(),
      }),
      execute: async ({ search, limit }) => {
        let q = supabase.from("factories").select("id, name, contact_person, phone, email").order("name").limit(limit ?? 20);
        if (search) q = q.or(`name.ilike.%${search}%,contact_person.ilike.%${search}%`);
        const { data, error } = await q;
        if (error) return `查詢失敗：${error.message}`;
        return data ?? [];
      },
    }),
  };

  // 依權限過濾工具，AI 只看得到被授權的工具
  return Object.fromEntries(
    allowedTools
      .filter((name) => name in allTools)
      .map((name) => [name, allTools[name as keyof typeof allTools]])
  );
}

export function createGroupTools(
  supabase: SupabaseClient,
  allowedTools: ToolName[],
  group: AgentGroup
) {
  const groupAllowed = filterByGroup(allowedTools, group);
  return createTools(supabase, groupAllowed);
}
