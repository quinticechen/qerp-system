import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { newLineItemKey, type OrderItemPayload } from '@/lib/documentItemsService';
import type { ProductLineItem } from '@/components/common/ProductLineItemsEditor';

export interface OrderItemRow {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  shipped_quantity: number | null;
  specifications: Json | null;
  total_rolls: number | null;
}

export interface EditableOrderItem extends ProductLineItem {
  shipped_quantity: number;
  specifications: Json | null;
  total_rolls: number | null;
}

export const newOrderItem = (): EditableOrderItem => ({
  key: newLineItemKey(),
  product_id: '',
  quantity: '',
  unit_price: '',
  shipped_quantity: 0,
  specifications: null,
  total_rolls: null,
});

export const toEditableOrderItem = (row: OrderItemRow): EditableOrderItem => ({
  key: row.id,
  id: row.id,
  product_id: row.product_id,
  quantity: String(row.quantity),
  unit_price: String(row.unit_price),
  shipped_quantity: Number(row.shipped_quantity ?? 0),
  specifications: row.specifications,
  total_rolls: row.total_rolls,
});

export const toOrderItemsPayload = (items: EditableOrderItem[]): OrderItemPayload[] =>
  items.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    product_id: item.product_id,
    quantity: Number(item.quantity),
    unit_price: Number(item.unit_price),
    specifications: item.specifications,
    total_rolls: item.total_rolls,
  }));

export const useOrderItems = (orderId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: ['order-items', orderId],
    queryFn: async (): Promise<OrderItemRow[]> => {
      const { data, error } = await supabase
        .from('order_products')
        .select('id, product_id, quantity, unit_price, shipped_quantity, specifications, total_rolls')
        .eq('order_id', orderId!)
        .order('created_at');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orderId && enabled,
  });
