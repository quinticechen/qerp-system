import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeSupabase } from "@/test/fakeSupabase";
import type { ProductRoll } from "@/hooks/useInventoryEditing";
import { RollDialog } from "./RollDialog";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

const roll: ProductRoll = {
  id: "roll-1",
  roll_number: "R-001",
  quantity: 100,
  current_quantity: 60,
  quality: "A",
  shelf: "A-01",
  is_allocated: false,
  warehouse_id: "wh-1",
  warehouses: { name: "一號倉" },
  inventories: { arrival_date: "2026-09-15", purchase_orders: { po_number: "PO-001" } },
};

const renderDialog = () => {
  fake.current = createFakeSupabase({
    warehouses: [
      { id: "wh-1", name: "一號倉", organization_id: "org-1" },
      { id: "wh-2", name: "二號倉", organization_id: "org-1" },
    ],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RollDialog roll={roll} organizationId="org-1" onOpenChange={() => {}} canEdit />
    </QueryClientProvider>,
  );
};

describe("RollDialog", () => {
  it("opens read-only and edits only after 編輯", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByText("40.00 公斤")).toBeInTheDocument();
    expect(screen.queryByLabelText("貨架")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "編輯" }));
    expect(screen.getByRole("dialog", { name: "編輯布卷 R-001" })).toBeInTheDocument();
  });

  it("saves only the changed location, quality and weight", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "編輯" }));

    await user.click(screen.getByLabelText("倉庫"));
    await user.click(await screen.findByRole("option", { name: "二號倉" }));
    const shelf = screen.getByLabelText("貨架");
    await user.clear(shelf);
    await user.type(shelf, "B-02");
    await user.click(screen.getByLabelText("品質"));
    await user.click(await screen.findByRole("option", { name: "B級" }));
    const quantity = screen.getByLabelText("入庫重量（公斤）");
    await user.clear(quantity);
    await user.type(quantity, "90");
    await user.click(screen.getByRole("button", { name: "更新" }));

    // Only the changed fields go to update_inventory_roll; the database keeps the shipped weight fixed
    await waitFor(() =>
      expect(fake.current!.rpcCalls).toEqual([
        {
          fn: "update_inventory_roll",
          args: {
            p_organization_id: "org-1",
            p_roll_id: "roll-1",
            p_changes: { warehouse_id: "wh-2", shelf: "B-02", quality: "B", quantity: 90 },
            p_dry_run: false,
          },
        },
      ]),
    );
  });

  it("tells the user when the new weight is below what has been shipped", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "編輯" }));

    const quantity = screen.getByLabelText("入庫重量（公斤）");
    await user.clear(quantity);
    await user.type(quantity, "30");
    await user.click(screen.getByRole("button", { name: "更新" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("入庫重量不可低於已出貨重量 40.00 公斤");
    expect(fake.current!.rpcCalls).toEqual([]);
  });
});
