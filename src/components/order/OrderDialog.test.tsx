import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeSupabase } from "@/test/fakeSupabase";
import { OrderDialog } from "./OrderDialog";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

const order = {
  id: "order-1",
  organization_id: "org-1",
  order_number: "26K1007-001",
  status: "confirmed",
  payment_status: "unpaid",
  shipping_status: "partial_shipped",
  note: "",
  created_at: "2026-10-01T00:00:00Z",
  customers: { name: "大東布行" },
  order_products: [],
};

const seedTables = () => ({
  order_products: [
    {
      id: "op-1",
      order_id: "order-1",
      product_id: "p-1",
      quantity: 100,
      unit_price: 10,
      shipped_quantity: 40,
      specifications: { width: 60 },
      total_rolls: 5,
      products_new: { name: "棉布", color: "白" },
    },
    {
      id: "op-2",
      order_id: "order-1",
      product_id: "p-2",
      quantity: 50,
      unit_price: 8,
      shipped_quantity: 0,
      specifications: null,
      total_rolls: null,
      products_new: { name: "麻布", color: null },
    },
  ],
  products_new: [
    { id: "p-1", name: "棉布", color: "白", organization_id: "org-1" },
    { id: "p-2", name: "麻布", color: null, organization_id: "org-1" },
    { id: "p-3", name: "絲綢", color: "紅", organization_id: "org-1" },
  ],
  purchase_order_relations: [] as Record<string, unknown>[],
  shippings: [],
});

const renderDialog = (options: { rpcError?: string } = {}) => {
  fake.current = createFakeSupabase(seedTables(), options);
  const onOpenChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OrderDialog order={order} open onOpenChange={onOpenChange} canEdit />
    </QueryClientProvider>,
  );
  return { onOpenChange };
};

// Record dialogs open in view mode; editing starts from the 編輯 button
const startEditing = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByText("棉布 - 白");
  await user.click(screen.getByRole("button", { name: "編輯" }));
};

describe("OrderDialog", () => {
  it("opens read-only with the order's products, and edits only after 編輯", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(await screen.findByText("棉布 - 白")).toBeInTheDocument();
    expect(screen.getByText("已出貨 40 公斤")).toBeInTheDocument();
    expect(screen.queryByLabelText("第 1 項數量（公斤）")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "編輯紀錄" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "編輯" }));
    expect(screen.getByRole("heading", { name: "編輯訂單" })).toBeInTheDocument();
    expect(screen.getByLabelText("第 1 項數量（公斤）")).toHaveValue("100");
    expect(screen.queryByRole("button", { name: "編輯紀錄" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消訂單" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("heading", { name: "訂單詳情" })).toBeInTheDocument();
  });

  it("saves changed, added and removed products in one call, keeping untouched fields", async () => {
    const user = userEvent.setup();
    renderDialog();
    await startEditing(user);

    const quantity = await screen.findByLabelText("第 1 項數量（公斤）");
    await user.clear(quantity);
    await user.type(quantity, "120");
    await user.click(screen.getByRole("button", { name: "刪除第 2 項" }));

    await user.click(screen.getByRole("button", { name: "新增產品" }));
    await user.click(screen.getByLabelText("第 2 項產品"));
    await user.click(await screen.findByRole("option", { name: "絲綢 - 紅" }));
    await user.type(screen.getByLabelText("第 2 項數量（公斤）"), "30");
    await user.type(screen.getByLabelText("第 2 項單價"), "15");

    await user.click(screen.getByRole("button", { name: "更新" }));

    // One update_order call carries the lines together with the order's own fields; unchanged shipping status is left out
    await waitFor(() =>
      expect(fake.current!.rpcCalls).toEqual([
        {
          fn: "update_order",
          args: {
            p_organization_id: "org-1",
            p_order_id: "order-1",
            p_changes: {
              status: "confirmed",
              payment_status: "unpaid",
              note: "",
              items: [
                { id: "op-1", product_id: "p-1", quantity: 120, unit_price: 10, specifications: { width: 60 }, total_rolls: 5 },
                { product_id: "p-3", quantity: 30, unit_price: 15, specifications: null, total_rolls: null },
              ],
            },
            p_dry_run: false,
          },
        },
      ]),
    );
    expect(fake.current!.updates.some((u) => u.table === "orders")).toBe(false);
  });

  it("locks the product and removal of an item that has been shipped", async () => {
    const user = userEvent.setup();
    renderDialog();
    await startEditing(user);

    const row = (await screen.findByLabelText("第 1 項數量（公斤）")).closest("tr")!;
    expect(within(row).getByText("已出貨 40 公斤")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "刪除第 1 項" })).toBeDisabled();
    expect(within(row).getByLabelText("第 1 項產品")).toBeDisabled();
  });

  it("shows a cancelled order read-only, with its reason and no way to save or cancel again", async () => {
    fake.current = createFakeSupabase(seedTables());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OrderDialog order={{ ...order, status: "cancelled", cancel_reason: "客戶取消" }} open onOpenChange={() => {}} canEdit />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/此訂單已取消，原因：客戶取消/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "訂單詳情" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "編輯" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消訂單" })).not.toBeInTheDocument();
  });

  it("shows why a save was rejected and keeps the dialog open", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ rpcError: "產品「棉布」的數量不可低於已出貨 40 公斤" });
    await startEditing(user);

    await screen.findByLabelText("第 1 項數量（公斤）");
    await user.click(screen.getByRole("button", { name: "更新" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("產品「棉布」的數量不可低於已出貨 40 公斤");
    expect(fake.current!.updates.some((u) => u.table === "orders")).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("shows the purchase orders linked to the order and locks the products they buy", async () => {
    const tables = seedTables();
    tables.purchase_order_relations = [
      {
        order_id: "order-1",
        purchase_orders: {
          id: "po-1",
          po_number: "P202610090001",
          status: "confirmed",
          order_date: "2026-10-09",
          factories: { name: "大東織造" },
          purchase_order_items: [{ id: "poi-1", product_id: "p-2", products_new: { name: "麻布", color: null } }],
        },
      },
    ];
    fake.current = createFakeSupabase(tables);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OrderDialog order={order} open onOpenChange={() => {}} canEdit />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("P202610090001")).toBeInTheDocument();
    const user = userEvent.setup();
    await startEditing(user);
    const row = (await screen.findByLabelText("第 2 項數量（公斤）")).closest("tr")!;
    await waitFor(() => expect(within(row).getByRole("button", { name: "刪除第 2 項" })).toBeDisabled());
  });
});
