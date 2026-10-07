import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/integrations/supabase/types';

// Each save sends the document's complete item list: rows with an id are updated,
// rows without one are added, and rows left out are deleted. Lock rules run in the database.

let lineItemCounter = 0;
// Stable React key for lines that do not exist in the database yet
export const newLineItemKey = () => `new-${++lineItemCounter}`;

export interface OrderItemPayload {
  id?: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  specifications: Json | null;
  total_rolls: number | null;
}

const callSave = async (
  client: SupabaseClient<Database>,
  fn: 'save_order_items' | 'save_purchase_order_items' | 'save_inventory_rolls' | 'save_shipping_items',
  args: Record<string, string | Json>,
): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rpc args are typed per function; callers pass the matching shape
  const { error } = await client.rpc(fn, args as any);
  if (error) throw new Error(error.message);
};

export const saveOrderItems = (client: SupabaseClient<Database>, orderId: string, items: OrderItemPayload[]) =>
  callSave(client, 'save_order_items', { p_order_id: orderId, p_items: items as unknown as Json });

export interface PurchaseOrderItemPayload {
  id?: string;
  product_id: string;
  ordered_quantity: number;
  ordered_rolls: number | null;
  unit_price: number;
  specifications: Json | null;
}

export const savePurchaseOrderItems = (
  client: SupabaseClient<Database>,
  purchaseOrderId: string,
  items: PurchaseOrderItemPayload[],
) =>
  callSave(client, 'save_purchase_order_items', {
    p_purchase_order_id: purchaseOrderId,
    p_items: items as unknown as Json,
  });

export interface InventoryRollPayload {
  id?: string;
  roll_number?: string;
  product_id: string;
  warehouse_id: string;
  shelf: string | null;
  quality: Database['public']['Enums']['fabric_quality'];
  quantity: number;
  specifications: Json | null;
}

export const saveInventoryRolls = (client: SupabaseClient<Database>, inventoryId: string, rolls: InventoryRollPayload[]) =>
  callSave(client, 'save_inventory_rolls', { p_inventory_id: inventoryId, p_rolls: rolls as unknown as Json });

export interface ShippingItemPayload {
  id?: string;
  inventory_roll_id: string;
  shipped_quantity: number;
}

export const saveShippingItems = (client: SupabaseClient<Database>, shippingId: string, items: ShippingItemPayload[]) =>
  callSave(client, 'save_shipping_items', { p_shipping_id: shippingId, p_items: items as unknown as Json });
