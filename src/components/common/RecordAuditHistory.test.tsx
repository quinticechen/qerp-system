import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeSupabase } from "@/test/fakeSupabase";
import { RecordAuditHistoryButton } from "./RecordAuditHistoryButton";

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
      id: "log-insert",
      table_name: "order_products",
      record_id: "op-2",
      parent_id: ORDER_ID,
      action: "INSERT",
      old_data: null,
      new_data: { id: "op-2", order_id: ORDER_ID, product_id: "p-2", quantity: 30, unit_price: 12, shipped_quantity: 0 },
      changed_fields: [],
      changed_by: "user-1",
      changed_at: "2026-10-01T02:00:00Z",
    },
    {
      id: "log-update",
      table_name: "order_products",
      record_id: "op-1",
      parent_id: ORDER_ID,
      action: "UPDATE",
      old_data: { id: "op-1", product_id: "p-1", quantity: 100, unit_price: 10 },
      new_data: { id: "op-1", product_id: "p-3", quantity: 80, unit_price: 10 },
      changed_fields: ["product_id", "quantity"],
      changed_by: "user-2",
      changed_at: "2026-10-03T05:30:00Z",
    },
    {
      id: "log-delete",
      table_name: "order_products",
      record_id: "op-3",
      parent_id: ORDER_ID,
      action: "DELETE",
      old_data: { id: "op-3", order_id: ORDER_ID, product_id: "p-1", quantity: 5, unit_price: 1 },
      new_data: null,
      changed_fields: [],
      changed_by: "user-2",
      changed_at: "2026-10-04T08:00:00Z",
    },
    {
      id: "log-other-order",
      table_name: "orders",
      record_id: "order-2",
      parent_id: null,
      action: "UPDATE",
      old_data: { note: "a" },
      new_data: { note: "b" },
      changed_fields: ["note"],
      changed_by: "user-1",
      changed_at: "2026-10-05T00:00:00Z",
    },
  ],
  profiles: [
    { id: "user-1", full_name: "王小明" },
    { id: "user-2", full_name: "陳美玲" },
  ],
  products_new: [
    { id: "p-1", name: "棉布", color: "白" },
    { id: "p-2", name: "麻布", color: null },
    { id: "p-3", name: "絲綢", color: "紅" },
  ],
});

const creation = { tableName: "orders", createdBy: "user-1", createdAt: "2026-09-30T01:00:00Z" };

const renderButton = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecordAuditHistoryButton recordId={ORDER_ID} creation={creation} />
    </QueryClientProvider>,
  );
};

describe("RecordAuditHistoryButton", () => {
  beforeEach(() => {
    fake.current = createFakeSupabase(seedTables());
  });

  it("is an icon-only button", () => {
    renderButton();

    const button = screen.getByRole("button", { name: "編輯紀錄" });
    expect(button).toHaveTextContent("");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("opens the document's history showing what was added, changed and removed, newest first", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "編輯紀錄" }));
    const panel = await screen.findByRole("dialog", { name: "編輯紀錄" });
    const entries = await within(panel).findAllByRole("listitem");
    expect(entries).toHaveLength(4);

    const [removed, changed, added] = entries;

    expect(within(removed).getByText("刪除訂單產品「棉布 - 白」")).toBeInTheDocument();
    expect(within(removed).getByText("陳美玲")).toBeInTheDocument();
    expect(within(removed).getByText("5")).toBeInTheDocument();

    expect(within(changed).getByText("修改訂單產品「絲綢 - 紅」")).toBeInTheDocument();
    expect(within(changed).getByText("棉布 - 白 → 絲綢 - 紅")).toBeInTheDocument();
    expect(within(changed).getByText("100 → 80")).toBeInTheDocument();
    expect(within(changed).queryByText("單價")).not.toBeInTheDocument();

    expect(within(added).getByText("新增訂單產品「麻布」")).toBeInTheDocument();
    expect(within(added).getByText("王小明")).toBeInTheDocument();
    expect(within(added).getByText("12")).toBeInTheDocument();
    expect(within(added).queryByText("出貨重量")).not.toBeInTheDocument();
  });

  it("shows who created a document that predates the edit log", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "編輯紀錄" }));
    const panel = await screen.findByRole("dialog", { name: "編輯紀錄" });
    const entries = await within(panel).findAllByRole("listitem");
    const created = entries[entries.length - 1];

    expect(within(created).getByText("新增訂單")).toBeInTheDocument();
    expect(within(created).getByText("王小明")).toBeInTheDocument();
  });

  it("does not repeat the creation when the log already has it", async () => {
    fake.current = createFakeSupabase({
      ...seedTables(),
      record_audit_logs: [
        {
          id: "log-created",
          table_name: "orders",
          record_id: ORDER_ID,
          parent_id: null,
          action: "INSERT",
          old_data: null,
          new_data: { id: ORDER_ID, note: "首批" },
          changed_fields: [],
          changed_by: "user-2",
          changed_at: "2026-10-06T00:00:00Z",
        },
      ],
    });
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "編輯紀錄" }));
    const panel = await screen.findByRole("dialog", { name: "編輯紀錄" });
    const entries = await within(panel).findAllByRole("listitem");

    expect(entries).toHaveLength(1);
    expect(within(entries[0]).getByText("陳美玲")).toBeInTheDocument();
  });
});

describe("RecordAuditHistoryButton for people and permissions", () => {
  const USER_ID = "user-9";

  beforeEach(() => {
    fake.current = createFakeSupabase({
      record_audit_logs: [
        {
          id: "log-profile",
          table_name: "profiles",
          record_id: USER_ID,
          parent_id: null,
          action: "UPDATE",
          old_data: { id: USER_ID, full_name: "林小華" },
          new_data: { id: USER_ID, full_name: "林大華" },
          changed_fields: ["full_name"],
          changed_by: "user-1",
          changed_at: "2026-10-07T03:00:00Z",
        },
        {
          id: "log-role",
          table_name: "user_organization_roles",
          record_id: "uor-1",
          parent_id: USER_ID,
          action: "INSERT",
          old_data: null,
          new_data: { id: "uor-1", user_id: USER_ID, role_id: "role-sales", is_active: true },
          changed_fields: [],
          changed_by: "user-1",
          changed_at: "2026-10-07T02:00:00Z",
        },
        {
          id: "log-permissions",
          table_name: "organization_roles",
          record_id: USER_ID,
          parent_id: null,
          action: "UPDATE",
          old_data: { permissions: { canEditProducts: false, canViewOrders: true } },
          new_data: { permissions: { canEditProducts: true, canViewOrders: false } },
          changed_fields: ["permissions"],
          changed_by: "user-1",
          changed_at: "2026-10-07T01:00:00Z",
        },
      ],
      profiles: [{ id: "user-1", full_name: "王小明" }],
      organization_roles: [{ id: "role-sales", display_name: "業務" }],
    });
  });

  it("shows profile, role assignment and permission changes in plain words", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <RecordAuditHistoryButton recordId={USER_ID} />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "編輯紀錄" }));
    const panel = await screen.findByRole("dialog", { name: "編輯紀錄" });
    const [profile, role, permissions] = await within(panel).findAllByRole("listitem");

    expect(within(profile).getByText("修改用戶資料「林大華」")).toBeInTheDocument();
    expect(within(profile).getByText("姓名")).toBeInTheDocument();
    expect(within(profile).getByText("林小華 → 林大華")).toBeInTheDocument();

    expect(within(role).getByText("新增成員角色「業務」")).toBeInTheDocument();

    expect(within(permissions).getByText("權限")).toBeInTheDocument();
    expect(within(permissions).getByText("開啟：編輯產品｜關閉：查看訂單")).toBeInTheDocument();
  });
});
