import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeSupabase } from "@/test/fakeSupabase";
import { EditShippingDialog } from "./EditShippingDialog";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

const shipping = {
  id: "ship-1",
  organization_id: "org-1",
  order_id: "order-1",
  shipping_number: "SHIP-20261007-0001",
  shipping_date: "2026-10-07",
  note: "",
};

const roll = (id: string, rollNumber: string, productId: string, current: number) => ({
  id,
  roll_number: rollNumber,
  product_id: productId,
  current_quantity: current,
  quality: "A",
  products_new: productId === "p-1" ? { name: "棉布", color: "白" } : { name: "麻布", color: null },
});

const seedTables = () => ({
  shipping_items: [
    { id: "si-1", shipping_id: "ship-1", inventory_roll_id: "roll-1", shipped_quantity: 40, inventory_rolls: roll("roll-1", "R-001", "p-1", 60) },
  ],
  order_products: [{ id: "op-1", order_id: "order-1", product_id: "p-1" }],
  inventory_rolls: [roll("roll-1", "R-001", "p-1", 60), roll("roll-2", "R-002", "p-1", 30), roll("roll-3", "R-003", "p-2", 50)],
});

const renderDialog = () => {
  fake.current = createFakeSupabase(seedTables());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <EditShippingDialog shipping={shipping} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
};

describe("EditShippingDialog roll editing", () => {
  it("saves changed and added shipped rolls in one call", async () => {
    const user = userEvent.setup();
    renderDialog();

    const weight = await screen.findByLabelText("第 1 卷出貨重量（公斤）");
    await user.clear(weight);
    await user.type(weight, "50");

    await user.click(screen.getByRole("button", { name: "新增出貨布卷" }));
    await user.click(screen.getByLabelText("第 2 卷布卷"));
    await user.click(await screen.findByRole("option", { name: /R-002/ }));
    await user.type(screen.getByLabelText("第 2 卷出貨重量（公斤）"), "10");

    await user.click(screen.getByRole("button", { name: "更新出貨單" }));

    await waitFor(() =>
      expect(fake.current!.rpcCalls).toEqual([
        {
          fn: "save_shipping_items",
          args: {
            p_shipping_id: "ship-1",
            p_items: [
              { id: "si-1", inventory_roll_id: "roll-1", shipped_quantity: 50 },
              { inventory_roll_id: "roll-2", shipped_quantity: 10 },
            ],
          },
        },
      ]),
    );
    await waitFor(() => expect(fake.current!.updates.some((u) => u.table === "shippings")).toBe(true));
  });

  it("shows how much each roll can ship and blocks more than that", async () => {
    const user = userEvent.setup();
    renderDialog();

    // 60kg left on the roll plus the 40kg this shipping already holds
    const row = (await screen.findByLabelText("第 1 卷出貨重量（公斤）")).closest("tr")!;
    expect(within(row).getByText("最多 100 公斤")).toBeInTheDocument();

    const weight = within(row).getByLabelText("第 1 卷出貨重量（公斤）");
    await user.clear(weight);
    await user.type(weight, "120");
    await user.click(screen.getByRole("button", { name: "更新出貨單" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("布卷「R-001」最多可出貨 100 公斤");
    expect(fake.current!.rpcCalls).toEqual([]);
  });

  it("only offers rolls of products on the order", async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByLabelText("第 1 卷出貨重量（公斤）");
    await user.click(screen.getByRole("button", { name: "新增出貨布卷" }));
    await user.click(screen.getByLabelText("第 2 卷布卷"));

    expect(await screen.findByRole("option", { name: /R-002/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /R-003/ })).not.toBeInTheDocument();
  });
});
