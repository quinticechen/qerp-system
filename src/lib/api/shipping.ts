import type { Json } from '@/integrations/supabase/types';
import type { ShippingItemPayload } from '@/lib/documentItemsService';
import { callApi } from './client';

// Shippings (docs/API.md §3, A5)

export interface NewShippingItem {
  inventory_roll_id: string;
  shipped_quantity: number;
}

export const createShipping = (
  organizationId: string,
  shipping: { orderId: string; items: NewShippingItem[]; shippingDate?: string; note?: string },
  dryRun = false,
) =>
  callApi('create_shipping', {
    p_organization_id: organizationId,
    p_order_id: shipping.orderId,
    p_items: shipping.items as unknown as Json,
    p_shipping_date: shipping.shippingDate || undefined,
    p_note: shipping.note,
    p_dry_run: dryRun,
  });

// Fields update_shipping accepts; items is the complete list that replaces the current one
export interface ShippingChanges {
  items?: ShippingItemPayload[];
  shipping_date?: string;
  note?: string;
}

export const updateShipping = (organizationId: string, shippingId: string, changes: ShippingChanges, dryRun = false) =>
  callApi('update_shipping', {
    p_organization_id: organizationId,
    p_shipping_id: shippingId,
    p_changes: changes as unknown as Json,
    p_dry_run: dryRun,
  });

// Puts the shipped weight back on each roll and recalculates the order's shipping progress
export const cancelShipping = (organizationId: string, shippingId: string, reason?: string, dryRun = false) =>
  callApi('cancel_shipping', {
    p_organization_id: organizationId,
    p_shipping_id: shippingId,
    p_reason: reason,
    p_dry_run: dryRun,
  });
