import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeSupabase } from "@/test/fakeSupabase";
import { PurchaseDialog } from "./PurchaseDialog";

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
      <PurchaseDialog purchase={purchase} open onOpenChange={() => {}} canEdit />
    </QueryClientProvider>,
  );
};

// Record dialogs open in view mode; editing starts from the 編輯 button
const startEditing = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByText("棉布 - 白");
  await user.click(screen.getByRole("button", { name: "編輯" }));
};

describe("PurchaseDialog", () => {
  it("opens read-only and shows what was received and when", async () => {
    fake.current = createFakeSupabase(seedTables());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PurchaseDialog
          purchase={{
            ...purchase,
            inventories: [
              { receipt_number: "I202610050001", arrival_date: "2026-10-05", inventory_rolls: [{ product_id: "p-1" }] },
              { receipt_number: "I202610090001", arrival_date: "2026-10-09", inventory_rolls: [{ product_id: "p-1" }] },
            ],
          }}
          open
          onOpenChange={() => {}}
          canEdit
        />
      </QueryClientProvider>,
    );

    const row = (await screen.findByText("棉布 - 白")).closest("tr")!;
    expect(within(row).getByText("已入庫 100 公斤")).toBeInTheDocument();
    expect(within(row).getByText(`入庫 ${new Date("2026-10-05").toLocaleDateString("zh-TW")}`)).toBeInTheDocument();
    expect(within(row).getByText(`入庫 ${new Date("2026-10-09").toLocaleDateString("zh-TW")}`)).toBeInTheDocument();
    expect(screen.getByText("I202610090001")).toBeInTheDocument();
    expect(screen.queryByLabelText("第 1 項採購數量（公斤）")).not.toBeInTheDocument();
  });

  it("saves changed, added and removed purchase items in one call, keeping untouched fields", async () => {
    const user = userEvent.setup();
    renderDialog();
    await startEditing(user);

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

    // One update_purchase_order call carries the items together with the dates and note; unchanged status is left out
    await waitFor(() =>
      expect(fake.current!.rpcCalls).toEqual([
        {
          fn: "update_purchase_order",
          args: {
            p_organization_id: "org-1",
            p_purchase_order_id: "po-1",
            p_changes: {
              items: [
                { id: "poi-1", product_id: "p-1", ordered_quantity: 150, ordered_rolls: 6, unit_price: 5, specifications: { width: 60 } },
                { product_id: "p-3", ordered_quantity: 40, ordered_rolls: 2, unit_price: 7, specifications: null },
              ],
              expected_arrival_date: "2026-10-20",
              note: "",
            },
            p_dry_run: false,
          },
        },
      ]),
    );
    expect(fake.current!.updates.some((u) => u.table === "purchase_orders")).toBe(false);
  });

  it("locks the product and removal of an item that has been received", async () => {
    const user = userEvent.setup();
    renderDialog();
    await startEditing(user);

    const row = (await screen.findByLabelText("第 1 項採購數量（公斤）")).closest("tr")!;
    expect(within(row).getByText("已入庫 100 公斤")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "刪除第 1 項" })).toBeDisabled();
    expect(within(row).getByLabelText("第 1 項產品")).toBeDisabled();
  });

  it("shows a cancelled purchase order read-only, without edit or cancel buttons", async () => {
    fake.current = createFakeSupabase(seedTables());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PurchaseDialog purchase={{ ...purchase, status: "cancelled", cancel_reason: "工廠缺料" }} open onOpenChange={() => {}} canEdit />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("此採購單已取消，原因：工廠缺料，不能再修改。")).toBeInTheDocument();
    expect(await screen.findByText("棉布 - 白")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "編輯" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消採購單" })).not.toBeInTheDocument();
  });
});
