import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeSupabase } from "@/test/fakeSupabase";
import { ViewInventoryDialog } from "./ViewInventoryDialog";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

const inventory = {
  id: "inv-1",
  organization_id: "org-1",
  arrival_date: "2026-09-15",
  factory_id: "factory-1",
  note: "首批",
  created_at: "2026-09-15T08:00:00Z",
  purchase_orders: { po_number: "PO-001" },
  factories: { name: "大東織造" },
};

const seedTables = () => ({
  inventory_rolls: [
    {
      id: "roll-1",
      inventory_id: "inv-1",
      roll_number: "R-001",
      product_id: "p-1",
      quantity: 100,
      current_quantity: 60,
      quality: "A",
      shelf: "A-01",
      is_allocated: false,
      warehouse_id: "wh-1",
      specifications: { width: 60 },
      products_new: { id: "p-1", name: "棉布", color: "白" },
      warehouses: { id: "wh-1", name: "一號倉" },
    },
    {
      id: "roll-2",
      inventory_id: "inv-1",
      roll_number: "R-002",
      product_id: "p-1",
      quantity: 20,
      current_quantity: 20,
      quality: "B",
      shelf: null,
      is_allocated: false,
      warehouse_id: "wh-1",
      specifications: null,
      products_new: { id: "p-1", name: "棉布", color: "白" },
      warehouses: { id: "wh-1", name: "一號倉" },
    },
  ],
  products_new: [
    { id: "p-1", name: "棉布", color: "白", organization_id: "org-1" },
    { id: "p-2", name: "麻布", color: null, organization_id: "org-1" },
  ],
  factories: [
    { id: "factory-1", name: "大東織造", organization_id: "org-1" },
    { id: "factory-2", name: "南興紡織", organization_id: "org-1" },
  ],
  warehouses: [
    { id: "wh-1", name: "一號倉", organization_id: "org-1" },
    { id: "wh-2", name: "二號倉", organization_id: "org-1" },
  ],
});

const renderDialog = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ViewInventoryDialog inventory={inventory} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
};

describe("ViewInventoryDialog editing", () => {
  beforeEach(() => {
    fake.current = createFakeSupabase(seedTables());
  });

  it("saves an edited batch note", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "編輯批次資料" }));
    const note = screen.getByLabelText("備註");
    await user.clear(note);
    await user.type(note, "已補齊");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() =>
      expect(fake.current!.rpcCalls).toEqual([
        {
          fn: "update_inventory",
          args: { p_organization_id: "org-1", p_inventory_id: "inv-1", p_changes: { arrival_date: "2026-09-15", note: "已補齊" }, p_dry_run: false },
        },
      ]),
    );
  });

  it("saves edits to a roll's location, quality and weight", async () => {
    const user = userEvent.setup();
    renderDialog();

    const row = (await screen.findByText("R-001")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "編輯布卷" }));

    const rollDialog = await screen.findByRole("dialog", { name: "編輯布卷 R-001" });
    await user.click(within(rollDialog).getByLabelText("倉庫"));
    await user.click(await screen.findByRole("option", { name: "二號倉" }));
    const shelf = within(rollDialog).getByLabelText("貨架");
    await user.clear(shelf);
    await user.type(shelf, "B-02");
    await user.click(within(rollDialog).getByLabelText("品質"));
    await user.click(await screen.findByRole("option", { name: "B級" }));
    const quantity = within(rollDialog).getByLabelText("入庫重量（公斤）");
    await user.clear(quantity);
    await user.type(quantity, "90");
    await user.click(within(rollDialog).getByRole("button", { name: "儲存" }));

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

    const row = (await screen.findByText("R-001")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "編輯布卷" }));
    const rollDialog = await screen.findByRole("dialog", { name: "編輯布卷 R-001" });
    const quantity = within(rollDialog).getByLabelText("入庫重量（公斤）");
    await user.clear(quantity);
    await user.type(quantity, "30");
    await user.click(within(rollDialog).getByRole("button", { name: "儲存" }));

    expect(await within(rollDialog).findByRole("alert")).toHaveTextContent(
      "入庫重量不可低於已出貨重量 40.00 公斤",
    );
    expect(fake.current!.rpcCalls).toEqual([]);
  });

  it("saves changed, added and removed rolls of the batch in one call", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "編輯布卷明細" }));
    const weight = await screen.findByLabelText("第 1 卷入庫重量（公斤）");
    await user.clear(weight);
    await user.type(weight, "90");
    await user.click(screen.getByRole("button", { name: "刪除第 2 卷" }));

    await user.click(screen.getByRole("button", { name: "新增布卷" }));
    const rollNumber = screen.getByLabelText("第 2 卷布卷編號");
    expect(rollNumber).not.toHaveValue("");
    await user.clear(rollNumber);
    await user.type(rollNumber, "R-NEW-1");
    await user.click(screen.getByLabelText("第 2 卷產品"));
    await user.click(await screen.findByRole("option", { name: "麻布" }));
    await user.click(screen.getByLabelText("第 2 卷倉庫"));
    await user.click(await screen.findByRole("option", { name: "二號倉" }));
    await user.type(screen.getByLabelText("第 2 卷入庫重量（公斤）"), "25");

    await user.click(screen.getByRole("button", { name: "儲存布卷" }));

    await waitFor(() =>
      expect(fake.current!.rpcCalls).toEqual([
        {
          fn: "update_inventory",
          args: {
            p_organization_id: "org-1",
            p_inventory_id: "inv-1",
            p_changes: {
              rolls: [
                { id: "roll-1", product_id: "p-1", warehouse_id: "wh-1", shelf: "A-01", quality: "A", quantity: 90, specifications: { width: 60 } },
                { roll_number: "R-NEW-1", product_id: "p-2", warehouse_id: "wh-2", shelf: null, quality: "A", quantity: 25, specifications: null },
              ],
            },
            p_dry_run: false,
          },
        },
      ]),
    );
  });

  it("locks the product and removal of a roll that has been shipped", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "編輯布卷明細" }));
    const row = (await screen.findByLabelText("第 1 卷入庫重量（公斤）")).closest("tr")!;
    expect(within(row).getByText("已出貨 40 公斤")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "刪除第 1 卷" })).toBeDisabled();
    expect(within(row).getByLabelText("第 1 卷產品")).toBeDisabled();
  });
});
