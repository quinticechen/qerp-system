import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeSupabase } from "@/test/fakeSupabase";
import { RecordAuditHistory } from "./RecordAuditHistory";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

const ORDER_ID = "order-1";

const seedTables = () => ({
  record_audit_logs: [
    {
      id: "log-1",
      table_name: "orders",
      record_id: ORDER_ID,
      parent_id: null,
      action: "INSERT",
      old_data: null,
      new_data: { id: ORDER_ID, note: "首批" },
      changed_fields: [],
      changed_by: "user-1",
      changed_at: "2026-10-01T02:00:00Z",
    },
    {
      id: "log-2",
      table_name: "order_products",
      record_id: "op-1",
      parent_id: ORDER_ID,
      action: "UPDATE",
      old_data: { quantity: 100, unit_price: 10 },
      new_data: { quantity: 80, unit_price: 10 },
      changed_fields: ["quantity"],
      changed_by: "user-2",
      changed_at: "2026-10-03T05:30:00Z",
    },
    {
      id: "log-other",
      table_name: "orders",
      record_id: "order-2",
      parent_id: null,
      action: "UPDATE",
      old_data: { note: "a" },
      new_data: { note: "b" },
      changed_fields: ["note"],
      changed_by: "user-1",
      changed_at: "2026-10-04T00:00:00Z",
    },
  ],
  profiles: [
    { id: "user-1", full_name: "王小明" },
    { id: "user-2", full_name: "陳美玲" },
  ],
});

const renderHistory = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecordAuditHistory recordId={ORDER_ID} />
    </QueryClientProvider>,
  );
};

describe("RecordAuditHistory", () => {
  beforeEach(() => {
    fake.current = createFakeSupabase(seedTables());
  });

  it("lists changes to the document and its line items, newest first, with editor and old → new values", async () => {
    renderHistory();

    const entries = await screen.findAllByRole("listitem");
    expect(entries).toHaveLength(2);

    expect(within(entries[0]).getByText("陳美玲")).toBeInTheDocument();
    expect(within(entries[0]).getByText("修改訂單產品")).toBeInTheDocument();
    expect(within(entries[0]).getByText("數量")).toBeInTheDocument();
    expect(within(entries[0]).getByText("100 → 80")).toBeInTheDocument();
    expect(within(entries[0]).queryByText("單價")).not.toBeInTheDocument();

    expect(within(entries[1]).getByText("王小明")).toBeInTheDocument();
    expect(within(entries[1]).getByText("新增訂單")).toBeInTheDocument();
  });
});
