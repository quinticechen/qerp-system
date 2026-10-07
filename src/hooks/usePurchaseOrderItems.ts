import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { newLineItemKey, type PurchaseOrderItemPayload } from '@/lib/documentItemsService';
import type { ProductLineItem } from '@/components/common/ProductLineItemsEditor';

export interface PurchaseOrderItemRow {
  id: string;
  product_id: string;
  ordered_quantity: number;
  ordered_rolls: number | null;
  unit_price: number;
  received_quantity: number | null;
  specifications: Json | null;
}

export interface EditablePurchaseOrderItem extends ProductLineItem {
  received_quantity: number;
  specifications: Json | null;
}

export const newPurchaseOrderItem = (): EditablePurchaseOrderItem => ({
  key: newLineItemKey(),
  product_id: '',
  quantity: '',
  unit_price: '',
  rolls: '',
  received_quantity: 0,
  specifications: null,
});

export const toEditablePurchaseOrderItem = (row: PurchaseOrderItemRow): EditablePurchaseOrderItem => ({
  key: row.id,
  id: row.id,
  product_id: row.product_id,
  quantity: String(row.ordered_quantity),
  unit_price: String(row.unit_price),
  rolls: row.ordered_rolls === null ? '' : String(row.ordered_rolls),
  received_quantity: Number(row.received_quantity ?? 0),
  specifications: row.specifications,
});

export const toPurchaseOrderItemsPayload = (items: EditablePurchaseOrderItem[]): PurchaseOrderItemPayload[] =>
  items.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    product_id: item.product_id,
    ordered_quantity: Number(item.quantity),
    ordered_rolls: item.rolls ? Number(item.rolls) : null,
    unit_price: Number(item.unit_price),
    specifications: item.specifications,
  }));

export const usePurchaseOrderItems = (purchaseOrderId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: ['purchase-order-items', purchaseOrderId],
    queryFn: async (): Promise<PurchaseOrderItemRow[]> => {
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select('id, product_id, ordered_quantity, ordered_rolls, unit_price, received_quantity, specifications')
        .eq('purchase_order_id', purchaseOrderId!)
        .order('created_at');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!purchaseOrderId && enabled,
  });
