import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeSupabase } from "@/test/fakeSupabase";
import { EnhancedInventorySummary } from "./EnhancedInventorySummary";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganizationContext: () => ({ currentOrganization: { id: "org-1", name: "測試組織" } }),
}));

const seedTables = () => ({
  products_new: [{ id: "p-1", organization_id: "org-1" }],
  inventory_summary_enhanced: [
    {
      product_id: "p-1",
      product_name: "棉布",
      color: "白",
      total_stock: 60,
      total_rolls: 1,
      a_grade_stock: 60,
      a_grade_rolls: 1,
      a_grade_details: ["60"],
    },
  ],
  inventory_rolls: [
    {
      id: "roll-1",
      product_id: "p-1",
      roll_number: "R-001",
      quantity: 100,
      current_quantity: 60,
      quality: "A",
      shelf: "A-01",
      is_allocated: false,
      warehouse_id: "wh-1",
      warehouses: { name: "一號倉" },
      inventories: { arrival_date: "2026-09-15", purchase_orders: { po_number: "PO-001" } },
    },
  ],
  warehouses: [{ id: "wh-1", name: "一號倉", organization_id: "org-1" }],
});

const renderSummary = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EnhancedInventorySummary />
    </QueryClientProvider>,
  );
};

describe("EnhancedInventorySummary roll editing", () => {
  beforeEach(() => {
    fake.current = createFakeSupabase(seedTables());
  });

  it("opens a product's rolls from its row and saves an edited roll", async () => {
    const user = userEvent.setup();
    renderSummary();

    await user.click(await screen.findByText("棉布"));
    const rollsDialog = await screen.findByRole("dialog", { name: "棉布 - 白 布卷明細" });
    const row = (await within(rollsDialog).findByText("R-001")).closest("tr")!;
    expect(within(row).getByText("PO-001")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "編輯布卷" }));
    const rollDialog = await screen.findByRole("dialog", { name: "編輯布卷 R-001" });
    const shelf = within(rollDialog).getByLabelText("貨架");
    await user.clear(shelf);
    await user.type(shelf, "C-07");
    await user.click(within(rollDialog).getByRole("button", { name: "儲存" }));

    await waitFor(() =>
      expect(fake.current!.rpcCalls).toContainEqual({
        fn: "update_inventory_roll",
        args: { p_organization_id: "org-1", p_roll_id: "roll-1", p_changes: { shelf: "C-07" }, p_dry_run: false },
      }),
    );
  });
});
