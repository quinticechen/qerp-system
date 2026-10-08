import type { Json } from '@/integrations/supabase/types';
import { callApi } from './client';
import type { OrderItemPayload } from '@/lib/documentItemsService';

// Orders (docs/BUSINESS_API.md §5, A2)

export interface NewOrderLine {
  product_id: string;
  quantity: number;
  unit_price: number;
  total_rolls?: number | null;
  specifications?: Json | null;
}

export const createOrder = (
  organizationId: string,
  order: { customerId: string; items: NewOrderLine[]; factoryIds?: string[]; note?: string },
  dryRun = false,
) =>
  callApi('create_order', {
    p_organization_id: organizationId,
    p_customer_id: order.customerId,
    p_items: order.items as unknown as Json,
    p_factory_ids: order.factoryIds ?? [],
    p_note: order.note,
    p_dry_run: dryRun,
  });

// Fields update_order accepts; items and factory_ids are complete lists that replace the current ones
export interface OrderChanges {
  items?: OrderItemPayload[];
  factory_ids?: string[];
  note?: string;
  status?: 'pending' | 'confirmed' | 'factory_ordered' | 'completed';
  payment_status?: 'unpaid' | 'partial_paid' | 'paid';
  shipping_status?: 'not_started' | 'partial_shipped' | 'shipped';
}

export const updateOrder = (organizationId: string, orderId: string, changes: OrderChanges, dryRun = false) =>
  callApi('update_order', {
    p_organization_id: organizationId,
    p_order_id: orderId,
    p_changes: changes as unknown as Json,
    p_dry_run: dryRun,
  });

export const cancelOrder = (organizationId: string, orderId: string, reason?: string, dryRun = false) =>
  callApi('cancel_order', {
    p_organization_id: organizationId,
    p_order_id: orderId,
    p_reason: reason,
    p_dry_run: dryRun,
  });
