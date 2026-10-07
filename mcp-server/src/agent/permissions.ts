/**
 * 權限層：工具分組
 *
 * 誰可以用哪個工具由資料庫決定（organization_roles.permissions，見 auth-guard.ts），
 * 每個工具在 src/tools/ 宣告自己需要的權限鍵。這裡只定義工具名稱與子 Agent 的分組。
 */

export type ToolName =
  | "list_customers" | "get_customer" | "create_customer"
  | "list_orders" | "get_order" | "create_order" | "update_order_status"
  | "list_products" | "get_product"
  | "get_inventory_summary" | "get_low_stock_alerts"
  | "list_purchase_orders" | "get_purchase_order" | "create_purchase_order"
  | "list_shippings" | "get_shipping"
  | "list_factories";

export type AgentGroup = "commercial" | "supply_chain" | "admin";

// 工具依功能群組分類
export const TOOL_GROUPS: Record<AgentGroup, ToolName[]> = {
  commercial: [
    "list_customers", "get_customer", "create_customer",
    "list_orders", "get_order", "create_order", "update_order_status",
    "list_products", "get_product",
  ],
  supply_chain: [
    // Product lookups are shared: the purchase-order flow needs product_id, and a missing
    // tool makes the model fail with NoSuchToolError.
    "list_products", "get_product",
    "get_inventory_summary", "get_low_stock_alerts",
    "list_purchase_orders", "get_purchase_order", "create_purchase_order",
    "list_shippings", "get_shipping",
    "list_factories",
  ],
  admin: [], // 保留：未來接 user/role 管理（D3：AI 僅唯讀）
};

export function filterByGroup(allowed: readonly ToolName[], group: AgentGroup): ToolName[] {
  const groupTools = TOOL_GROUPS[group];
  return allowed.filter((t) => groupTools.includes(t));
}
