import type { Json } from '@/integrations/supabase/types';
import type { PurchaseOrderItemPayload } from '@/lib/documentItemsService';
import { callApi } from './client';

// Purchase orders (docs/API.md §3, A3)

export interface NewPurchaseOrderItem {
  product_id: string;
  ordered_quantity: number;
  unit_price: number;
  ordered_rolls?: number | null;
  specifications?: Json | null;
}

export const createPurchaseOrder = (
  organizationId: string,
  purchase: {
    factoryId: string;
    items: NewPurchaseOrderItem[];
    orderIds?: string[];
    expectedArrivalDate?: string;
    note?: string;
  },
  dryRun = false,
) =>
  callApi('create_purchase_order', {
    p_organization_id: organizationId,
    p_factory_id: purchase.factoryId,
    p_items: purchase.items as unknown as Json,
    p_order_ids: purchase.orderIds ?? [],
    p_expected_arrival_date: purchase.expectedArrivalDate || undefined,
    p_note: purchase.note,
    p_dry_run: dryRun,
  });

// Fields update_purchase_order accepts; items and order_ids are complete lists that replace the current ones.
// Dates are YYYY-MM-DD; an empty string clears the arrival date.
export interface PurchaseOrderChanges {
  items?: PurchaseOrderItemPayload[];
  order_ids?: string[];
  factory_id?: string;
  order_date?: string;
  expected_arrival_date?: string;
  note?: string;
  status?: 'pending' | 'confirmed' | 'partial_received' | 'completed';
}

export const updatePurchaseOrder = (organizationId: string, purchaseOrderId: string, changes: PurchaseOrderChanges, dryRun = false) =>
  callApi('update_purchase_order', {
    p_organization_id: organizationId,
    p_purchase_order_id: purchaseOrderId,
    p_changes: changes as unknown as Json,
    p_dry_run: dryRun,
  });

export const cancelPurchaseOrder = (organizationId: string, purchaseOrderId: string, reason?: string, dryRun = false) =>
  callApi('cancel_purchase_order', {
    p_organization_id: organizationId,
    p_purchase_order_id: purchaseOrderId,
    p_reason: reason,
    p_dry_run: dryRun,
  });
