import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeSupabase } from "@/test/fakeSupabase";
import { EditPurchaseDialog } from "./EditPurchaseDialog";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

const purchase = {
  id: "po-1",
  organization_id: "org-1",
  po_number: "PO-20261007-0001",
  status: "partial_received",
  expected_arrival_date: "2026-10-20",
  note: "",
};

const seedTables = () => ({
  purchase_order_items: [
    {
      id: "poi-1",
      purchase_order_id: "po-1",
      product_id: "p-1",
      ordered_quantity: 100,
      ordered_rolls: 4,
      unit_price: 5,
      received_quantity: 100,
      specifications: { width: 60 },
    },
    {
      id: "poi-2",
      purchase_order_id: "po-1",
      product_id: "p-2",
      ordered_quantity: 50,
      ordered_rolls: 2,
      unit_price: 4,
      received_quantity: 0,
      specifications: null,
    },
  ],
  products_new: [
    { id: "p-1", name: "棉布", color: "白", organization_id: "org-1" },
    { id: "p-2", name: "麻布", color: null, organization_id: "org-1" },
    { id: "p-3", name: "絲綢", color: "紅", organization_id: "org-1" },
  ],
});

const renderDialog = () => {
  fake.current = createFakeSupabase(seedTables());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <EditPurchaseDialog purchase={purchase} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
};

describe("EditPurchaseDialog product editing", () => {
  it("saves changed, added and removed purchase items in one call, keeping untouched fields", async () => {
    const user = userEvent.setup();
    renderDialog();

    const quantity = await screen.findByLabelText("第 1 項採購數量（公斤）");
    await user.clear(quantity);
    await user.type(quantity, "150");
    const rolls = screen.getByLabelText("第 1 項卷數");
    await user.clear(rolls);
    await user.type(rolls, "6");
    await user.click(screen.getByRole("button", { name: "刪除第 2 項" }));

    await user.click(screen.getByRole("button", { name: "新增產品" }));
    await user.click(screen.getByLabelText("第 2 項產品"));
    await user.click(await screen.findByRole("option", { name: "絲綢 - 紅" }));
    await user.type(screen.getByLabelText("第 2 項採購數量（公斤）"), "40");
    await user.type(screen.getByLabelText("第 2 項卷數"), "2");
    await user.type(screen.getByLabelText("第 2 項單價"), "7");

    await user.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() =>
      expect(fake.current!.rpcCalls).toEqual([
        {
          fn: "save_purchase_order_items",
          args: {
            p_purchase_order_id: "po-1",
            p_items: [
              { id: "poi-1", product_id: "p-1", ordered_quantity: 150, ordered_rolls: 6, unit_price: 5, specifications: { width: 60 } },
              { product_id: "p-3", ordered_quantity: 40, ordered_rolls: 2, unit_price: 7, specifications: null },
            ],
          },
        },
      ]),
    );
    await waitFor(() => expect(fake.current!.updates.some((u) => u.table === "purchase_orders")).toBe(true));
  });

  it("locks the product and removal of an item that has been received", async () => {
    renderDialog();

    const row = (await screen.findByLabelText("第 1 項採購數量（公斤）")).closest("tr")!;
    expect(within(row).getByText("已入庫 100 公斤")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "刪除第 1 項" })).toBeDisabled();
    expect(within(row).getByLabelText("第 1 項產品")).toBeDisabled();
  });
});
