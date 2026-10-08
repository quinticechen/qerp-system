import type { Database } from "@/integrations/supabase/types";
import { updateInventory, updateInventoryRollApi } from "@/lib/api/inventory";

export interface RollSnapshot {
  id: string;
  quantity: number;
  current_quantity: number;
}

export interface RollEdits {
  quantity?: number;
  quality?: Database["public"]["Enums"]["fabric_quality"];
  warehouse_id?: string;
  shelf?: string | null;
}

// Only the changed fields are sent; the database keeps the shipped weight fixed and checks the lock rules again
export const updateInventoryRoll = async (organizationId: string, roll: RollSnapshot, edits: RollEdits): Promise<void> => {
  if (edits.quantity !== undefined) {
    // Shipped weight (quantity - current_quantity) stays fixed when the received weight is corrected
    const shipped = roll.quantity - roll.current_quantity;
    if (edits.quantity < shipped) {
      throw new Error(`入庫重量不可低於已出貨重量 ${shipped.toFixed(2)} 公斤`);
    }
  }
  await updateInventoryRollApi(organizationId, roll.id, edits);
};

export interface BatchEdits {
  arrival_date?: string;
  note?: string | null;
}

export const updateInventoryBatch = async (organizationId: string, inventoryId: string, edits: BatchEdits): Promise<void> => {
  await updateInventory(organizationId, inventoryId, {
    ...(edits.arrival_date !== undefined ? { arrival_date: edits.arrival_date } : {}),
    ...(edits.note !== undefined ? { note: edits.note?.trim() ?? "" } : {}),
  });
};
