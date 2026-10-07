import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { updateInventoryBatch, updateInventoryRoll } from "./inventoryService";

interface RecordedUpdate {
  table: string;
  payload: Record<string, unknown>;
  filter: [string, unknown];
}

const createFakeClient = (error: { message: string } | null = null) => {
  const updates: RecordedUpdate[] = [];
  const client = {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => ({
        eq: async (column: string, value: unknown) => {
          updates.push({ table, payload, filter: [column, value] });
          return { error };
        },
      }),
    }),
  } as unknown as SupabaseClient<Database>;
  return { client, updates };
};

describe("updateInventoryRoll", () => {
  it("keeps the shipped amount when the received weight changes", async () => {
    const { client, updates } = createFakeClient();
    const roll = { id: "roll-1", quantity: 100, current_quantity: 60 };

    await updateInventoryRoll(client, roll, { quantity: 90 });

    expect(updates).toEqual([
      {
        table: "inventory_rolls",
        payload: { quantity: 90, current_quantity: 50, is_allocated: false },
        filter: ["id", "roll-1"],
      },
    ]);
  });

  it("rejects a received weight below what has already been shipped", async () => {
    const { client, updates } = createFakeClient();
    const roll = { id: "roll-1", quantity: 100, current_quantity: 60 };

    await expect(updateInventoryRoll(client, roll, { quantity: 30 })).rejects.toThrow(
      "入庫重量不可低於已出貨重量 40.00 公斤",
    );
    expect(updates).toEqual([]);
  });

  it("updates quality, warehouse and shelf without touching weights", async () => {
    const { client, updates } = createFakeClient();
    const roll = { id: "roll-2", quantity: 50, current_quantity: 50 };

    await updateInventoryRoll(client, roll, { quality: "B", warehouse_id: "wh-2", shelf: "A-03" });

    expect(updates).toEqual([
      {
        table: "inventory_rolls",
        payload: { quality: "B", warehouse_id: "wh-2", shelf: "A-03" },
        filter: ["id", "roll-2"],
      },
    ]);
  });

  it("surfaces the database error when the update fails", async () => {
    const { client } = createFakeClient({ message: "permission denied" });
    const roll = { id: "roll-2", quantity: 50, current_quantity: 50 };

    await expect(updateInventoryRoll(client, roll, { quality: "C" })).rejects.toMatchObject({
      message: "permission denied",
    });
  });
});

describe("updateInventoryBatch", () => {
  it("saves the arrival date, factory and note of a batch", async () => {
    const { client, updates } = createFakeClient();

    await updateInventoryBatch(client, "inv-1", {
      arrival_date: "2026-10-01",
      factory_id: "factory-9",
      note: "第二批",
    });

    expect(updates).toEqual([
      {
        table: "inventories",
        payload: { arrival_date: "2026-10-01", factory_id: "factory-9", note: "第二批" },
        filter: ["id", "inv-1"],
      },
    ]);
  });

  it("stores an empty note as null", async () => {
    const { client, updates } = createFakeClient();

    await updateInventoryBatch(client, "inv-1", { note: "  " });

    expect(updates[0].payload).toEqual({ note: null });
  });
});
