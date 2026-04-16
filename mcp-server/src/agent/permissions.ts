/**
 * 權限層：定義每個角色可以使用哪些 MCP 工具
 * 這是 hard-coded 的守門員，AI 只會看到被授權的工具
 */

export type ToolName =
  | "list_customers" | "get_customer" | "create_customer"
  | "list_orders" | "get_order" | "create_order" | "update_order_status"
  | "list_products" | "get_product"
  | "get_inventory_summary" | "get_low_stock_alerts"
  | "list_purchase_orders" | "get_purchase_order"
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
    "get_inventory_summary", "get_low_stock_alerts",
    "list_purchase_orders", "get_purchase_order",
    "list_shippings", "get_shipping",
    "list_factories",
  ],
  admin: [], // 保留：未來接 user/role 管理
};

// 每個角色允許使用的工具（hard-coded，AI 看不到被排除的工具）
const ROLE_PERMISSIONS: Record<string, ToolName[]> = {
  admin: [
    ...TOOL_GROUPS.commercial,
    ...TOOL_GROUPS.supply_chain,
  ],
  sales: [
    "list_customers", "get_customer", "create_customer",
    "list_orders", "get_order", "create_order", "update_order_status",
    "list_products", "get_product",
    "get_inventory_summary", "get_low_stock_alerts",
  ],
  assistant: [
    "list_customers", "get_customer", "create_customer",
    "list_orders", "get_order", "create_order", "update_order_status",
    "list_products", "get_product",
    "get_inventory_summary", "get_low_stock_alerts",
    "list_shippings", "get_shipping",
  ],
  warehouse: [
    "get_inventory_summary", "get_low_stock_alerts",
    "list_purchase_orders", "get_purchase_order",
    "list_shippings", "get_shipping",
    "list_factories",
  ],
  accounting: [
    "list_orders", "get_order",
    "list_customers", "get_customer",
    "list_shippings", "get_shipping",
  ],
};

export function getAllowedTools(roles: string[]): ToolName[] {
  const allowed = new Set<ToolName>();
  for (const role of roles) {
    const tools = ROLE_PERMISSIONS[role] ?? [];
    tools.forEach((t) => allowed.add(t));
  }
  return Array.from(allowed);
}

export function filterByGroup(allowed: ToolName[], group: AgentGroup): ToolName[] {
  const groupTools = TOOL_GROUPS[group];
  return allowed.filter((t) => groupTools.includes(t));
}
