import type { Json } from '@/integrations/supabase/types';
import type { InventoryRollPayload } from '@/lib/documentItemsService';
import { callApi } from './client';

// Receiving batches (進貨單) and their rolls (docs/API.md §3, A4)

export interface NewInventoryRoll {
  product_id: string;
  quantity: number;
  warehouse_id: string;
  shelf?: string | null;
  quality?: InventoryRollPayload['quality'];
  // Left out, the system numbers the roll
  roll_number?: string;
  specifications?: Json | null;
}

export const receiveInventory = (
  organizationId: string,
  receipt: { purchaseOrderId: string; rolls: NewInventoryRoll[]; arrivalDate?: string; note?: string },
  dryRun = false,
) =>
  callApi('receive_inventory', {
    p_organization_id: organizationId,
    p_purchase_order_id: receipt.purchaseOrderId,
    p_rolls: receipt.rolls as unknown as Json,
    p_arrival_date: receipt.arrivalDate || undefined,
    p_note: receipt.note,
    p_dry_run: dryRun,
  });

// Fields update_inventory accepts; rolls is the complete list that replaces the current one
export interface InventoryChanges {
  rolls?: InventoryRollPayload[];
  arrival_date?: string;
  note?: string;
}

export const updateInventory = (organizationId: string, inventoryId: string, changes: InventoryChanges, dryRun = false) =>
  callApi('update_inventory', {
    p_organization_id: organizationId,
    p_inventory_id: inventoryId,
    p_changes: changes as unknown as Json,
    p_dry_run: dryRun,
  });

export interface InventoryRollChanges {
  quantity?: number;
  quality?: InventoryRollPayload['quality'];
  warehouse_id?: string;
  shelf?: string | null;
}

export const updateInventoryRollApi = (organizationId: string, rollId: string, changes: InventoryRollChanges, dryRun = false) =>
  callApi('update_inventory_roll', {
    p_organization_id: organizationId,
    p_roll_id: rollId,
    p_changes: changes as unknown as Json,
    p_dry_run: dryRun,
  });
