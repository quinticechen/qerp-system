/**
 * 權限層：工具分組
 *
 * 誰可以用哪個工具由資料庫決定（role_permissions，經 user_has_organization_permission()，見 auth-guard.ts），
 * 每個工具在 src/tools/ 宣告自己需要的權限鍵。這裡只定義工具名稱與子 Agent 的分組。
 */

export type ToolName =
  | "list_customers" | "get_customer" | "create_customer" | "update_customer" | "set_customer_active"
  | "list_orders" | "get_order" | "create_order" | "update_order_status" | "update_order" | "cancel_order"
  | "list_products" | "get_product" | "create_product" | "update_product" | "set_product_active"
  | "add_product_color" | "update_product_color" | "set_product_color_active"
  | "get_inventory_summary" | "get_low_stock_alerts" | "list_inventory_rolls" | "update_inventory_roll"
  | "list_purchase_orders" | "get_purchase_order" | "create_purchase_order" | "update_purchase_order" | "cancel_purchase_order"
  | "list_receivings" | "receive_inventory" | "update_inventory"
  | "list_shippings" | "get_shipping" | "create_shipping" | "update_shipping" | "cancel_shipping"
  | "list_factories" | "create_factory" | "update_factory" | "set_factory_active"
  | "list_shelves" | "create_shelf" | "update_shelf" | "set_shelf_active";

export type AgentGroup = "commercial" | "supply_chain" | "warehouse" | "catalog" | "facilities" | "admin";

/** Groups the router can send a task to, in the order replies are merged. */
export const ROUTABLE_GROUPS = ["commercial", "supply_chain", "warehouse", "catalog", "facilities"] as const;
export type RoutableGroup = (typeof ROUTABLE_GROUPS)[number];

/** Section headings when several sub-agents answer one message. */
export const GROUP_LABELS: Record<RoutableGroup, string> = {
  commercial: "📋 客戶與訂單",
  supply_chain: "🏭 採購與入庫",
  warehouse: "📦 庫存與出貨",
  catalog: "🧵 產品",
  facilities: "🗄️ 工廠與貨架",
};

// Each sub-agent keeps about 10–12 tools: more made gemini-2.5-flash-lite's tool calls malformed
// (docs/requirements/QUERY_AGENT_PHASE1.md §5). Lookups a workflow needs (e.g. list_products to get a
// product_id) are repeated in every group that needs them, so a task stays inside one agent.
export const TOOL_GROUPS: Record<AgentGroup, ToolName[]> = {
  commercial: [
    "list_customers", "get_customer", "create_customer", "update_customer", "set_customer_active",
    "list_orders", "get_order", "create_order", "update_order_status", "update_order", "cancel_order",
    "list_products",
  ],
  supply_chain: [
    "list_purchase_orders", "get_purchase_order", "create_purchase_order", "update_purchase_order", "cancel_purchase_order",
    "list_receivings", "receive_inventory", "update_inventory",
    "list_factories", "list_products", "list_shelves", "list_orders",
  ],
  warehouse: [
    "get_inventory_summary", "get_low_stock_alerts", "list_inventory_rolls", "update_inventory_roll",
    "list_shippings", "get_shipping", "create_shipping", "update_shipping", "cancel_shipping",
    // get_order: how much of each line is shipped (order_products.shipped_quantity). Shelves are
    // named directly: update_inventory_roll and list_inventory_rolls take a shelf name.
    "list_orders", "get_order", "list_products",
  ],
  catalog: [
    "list_products", "get_product", "create_product", "update_product", "set_product_active",
    "add_product_color", "update_product_color", "set_product_color_active",
    "get_inventory_summary", // 「還有沒有雲朵眠」 asks for stock as well as colors
  ],
  facilities: [
    "list_factories", "create_factory", "update_factory", "set_factory_active",
    "list_shelves", "create_shelf", "update_shelf", "set_shelf_active",
  ],
  admin: [], // 保留：未來接 user/role 管理（D3：AI 僅唯讀）
};

export function filterByGroup(allowed: readonly ToolName[], group: AgentGroup): ToolName[] {
  const groupTools = TOOL_GROUPS[group];
  return allowed.filter((t) => groupTools.includes(t));
}
