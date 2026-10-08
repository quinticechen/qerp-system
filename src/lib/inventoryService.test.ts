import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/test/fakeSupabase";
import { updateInventoryBatch, updateInventoryRoll } from "./inventoryService";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

const setup = (rpcError?: string) => {
  fake.current = createFakeSupabase({}, { rpcError });
  return fake.current;
};

describe("updateInventoryRoll", () => {
  it("sends the new received weight to update_inventory_roll", async () => {
    const { rpcCalls } = setup();
    const roll = { id: "roll-1", quantity: 100, current_quantity: 60 };

    await updateInventoryRoll("org-1", roll, { quantity: 90 });

    expect(rpcCalls).toEqual([
      {
        fn: "update_inventory_roll",
        args: { p_organization_id: "org-1", p_roll_id: "roll-1", p_changes: { quantity: 90 }, p_dry_run: false },
      },
    ]);
  });

  it("rejects a received weight below what has already been shipped", async () => {
    const { rpcCalls } = setup();
    const roll = { id: "roll-1", quantity: 100, current_quantity: 60 };

    await expect(updateInventoryRoll("org-1", roll, { quantity: 30 })).rejects.toThrow(
      "入庫重量不可低於已出貨重量 40.00 公斤",
    );
    expect(rpcCalls).toEqual([]);
  });

  it("sends quality, warehouse and shelf changes", async () => {
    const { rpcCalls } = setup();
    const roll = { id: "roll-2", quantity: 50, current_quantity: 50 };

    await updateInventoryRoll("org-1", roll, { quality: "B", warehouse_id: "wh-2", shelf: "A-03" });

    expect(rpcCalls[0].args.p_changes).toEqual({ quality: "B", warehouse_id: "wh-2", shelf: "A-03" });
  });

  it("surfaces the database error when the update fails", async () => {
    setup("permission denied");
    const roll = { id: "roll-2", quantity: 50, current_quantity: 50 };

    await expect(updateInventoryRoll("org-1", roll, { quality: "C" })).rejects.toMatchObject({
      message: "permission denied",
    });
  });
});

describe("updateInventoryBatch", () => {
  it("saves the arrival date and note of a batch", async () => {
    const { rpcCalls } = setup();

    await updateInventoryBatch("org-1", "inv-1", { arrival_date: "2026-10-01", note: "第二批" });

    expect(rpcCalls).toEqual([
      {
        fn: "update_inventory",
        args: { p_organization_id: "org-1", p_inventory_id: "inv-1", p_changes: { arrival_date: "2026-10-01", note: "第二批" }, p_dry_run: false },
      },
    ]);
  });

  it("sends an empty note to clear it", async () => {
    const { rpcCalls } = setup();

    await updateInventoryBatch("org-1", "inv-1", { note: "  " });

    expect(rpcCalls[0].args.p_changes).toEqual({ note: "" });
  });
});
