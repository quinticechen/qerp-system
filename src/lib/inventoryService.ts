import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type InventoryRollUpdate = Database["public"]["Tables"]["inventory_rolls"]["Update"];
type InventoryUpdate = Database["public"]["Tables"]["inventories"]["Update"];

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

export const updateInventoryRoll = async (
  client: SupabaseClient<Database>,
  roll: RollSnapshot,
  edits: RollEdits,
): Promise<void> => {
  const payload: InventoryRollUpdate = {};
  if (edits.quality !== undefined) payload.quality = edits.quality;
  if (edits.warehouse_id !== undefined) payload.warehouse_id = edits.warehouse_id;
  if (edits.shelf !== undefined) payload.shelf = edits.shelf;

  if (edits.quantity !== undefined) {
    // Shipped weight (quantity - current_quantity) stays fixed when the received weight is corrected
    const shipped = roll.quantity - roll.current_quantity;
    if (edits.quantity < shipped) {
      throw new Error(`入庫重量不可低於已出貨重量 ${shipped.toFixed(2)} 公斤`);
    }
    const currentQuantity = edits.quantity - shipped;
    payload.quantity = edits.quantity;
    payload.current_quantity = currentQuantity;
    payload.is_allocated = currentQuantity <= 0;
  }

  const { error } = await client.from("inventory_rolls").update(payload).eq("id", roll.id);
  if (error) throw error;
};

export interface BatchEdits {
  arrival_date?: string;
  factory_id?: string;
  note?: string | null;
}

export const updateInventoryBatch = async (
  client: SupabaseClient<Database>,
  inventoryId: string,
  edits: BatchEdits,
): Promise<void> => {
  const payload: InventoryUpdate = {};
  if (edits.arrival_date !== undefined) payload.arrival_date = edits.arrival_date;
  if (edits.factory_id !== undefined) payload.factory_id = edits.factory_id;
  if (edits.note !== undefined) payload.note = edits.note?.trim() || null;

  const { error } = await client.from("inventories").update(payload).eq("id", inventoryId);
  if (error) throw error;
};
