import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { newLineItemKey, type ShippingItemPayload } from '@/lib/documentItemsService';
import type { FabricQuality } from '@/lib/fabricQuality';

export interface ShippableRoll {
  id: string;
  roll_number: string;
  product_id: string;
  current_quantity: number;
  quality: FabricQuality;
  products_new: { name: string; color: string | null } | null;
}

export interface ShippingItemRow {
  id: string;
  inventory_roll_id: string;
  shipped_quantity: number;
  inventory_rolls: ShippableRoll | null;
}

// Form state for one shipped roll; weight stays a string while the user types
export interface EditableShippingItem {
  key: string;
  id?: string;
  inventory_roll_id: string;
  shipped_quantity: string;
}

const ROLL_FIELDS = 'id, roll_number, product_id, current_quantity, quality, products_new (name, color)';

export const newShippingItem = (): EditableShippingItem => ({
  key: newLineItemKey(),
  inventory_roll_id: '',
  shipped_quantity: '',
});

export const toEditableShippingItem = (row: ShippingItemRow): EditableShippingItem => ({
  key: row.id,
  id: row.id,
  inventory_roll_id: row.inventory_roll_id,
  shipped_quantity: String(row.shipped_quantity),
});

export const toShippingItemsPayload = (items: EditableShippingItem[]): ShippingItemPayload[] =>
  items.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    inventory_roll_id: item.inventory_roll_id,
    shipped_quantity: Number(item.shipped_quantity),
  }));

// Most a roll can carry in this shipping: what is left in stock plus what this shipping already took from it
export const rollCapacity = (roll: ShippableRoll, originalItems: ShippingItemRow[]) =>
  Number(roll.current_quantity) +
  originalItems
    .filter((item) => item.inventory_roll_id === roll.id)
    .reduce((sum, item) => sum + Number(item.shipped_quantity), 0);

export const useShippingItems = (shippingId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: ['shipping-items', shippingId],
    queryFn: async (): Promise<ShippingItemRow[]> => {
      const { data, error } = await supabase
        .from('shipping_items')
        .select(`id, inventory_roll_id, shipped_quantity, inventory_rolls (${ROLL_FIELDS})`)
        .eq('shipping_id', shippingId!)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as unknown as ShippingItemRow[];
    },
    enabled: !!shippingId && enabled,
  });

// Rolls with stock left whose product is on the order being shipped
export const useShippableRolls = (orderId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: ['shippable-rolls', orderId],
    queryFn: async (): Promise<ShippableRoll[]> => {
      const { data: orderProducts, error: orderError } = await supabase
        .from('order_products')
        .select('product_id')
        .eq('order_id', orderId!);
      if (orderError) throw orderError;

      const productIds = [...new Set((orderProducts ?? []).map((item) => item.product_id))];
      if (productIds.length === 0) return [];

      const { data, error } = await supabase
        .from('inventory_rolls')
        .select(ROLL_FIELDS)
        .in('product_id', productIds)
        .gt('current_quantity', 0)
        .order('roll_number');
      if (error) throw error;
      return (data ?? []) as unknown as ShippableRoll[];
    },
    enabled: !!orderId && enabled,
  });
