import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordDialog, type RecordDialogMode } from "./RecordDialog";

const renderDialog = (mode: RecordDialogMode, handlers: Partial<Record<"onEdit" | "onCancelEdit" | "onSubmit" | "onOpenChange", () => void>> = {}) =>
  render(
    <RecordDialog
      open
      onOpenChange={handlers.onOpenChange ?? (() => {})}
      mode={mode}
      title="客戶詳情"
      history={{ recordId: "c-1" }}
      onEdit={handlers.onEdit}
      onCancelEdit={handlers.onCancelEdit}
      onSubmit={handlers.onSubmit}
      editActions={<button type="button">停用客戶</button>}
    >
      <p>內容</p>
    </RecordDialog>,
  );

describe("RecordDialog", () => {
  it("view mode: history and close at the top, 編輯 at the bottom right, nothing else", async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    renderDialog("view", { onEdit });

    const dialog = screen.getByRole("dialog", { name: "客戶詳情" });
    expect(within(dialog).getByRole("button", { name: "編輯紀錄" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "停用客戶" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "更新" })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "編輯" }));
    expect(onEdit).toHaveBeenCalled();
  });

  it("view mode without permission has no 編輯 button", () => {
    renderDialog("view");
    expect(screen.queryByRole("button", { name: "編輯" })).not.toBeInTheDocument();
  });

  it("edit mode: only close at the top, 取消 + 更新 at the bottom right, the status action at the bottom left", async () => {
    const onCancelEdit = vi.fn();
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderDialog("edit", { onCancelEdit, onSubmit });

    expect(screen.queryByRole("button", { name: "編輯紀錄" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停用客戶" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "更新" }));
    expect(onSubmit).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancelEdit).toHaveBeenCalled();
  });

  it("closing while editing discards the edit", async () => {
    const onCancelEdit = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog("edit", { onCancelEdit, onOpenChange });

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancelEdit).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("create mode: 取消 closes, 建立 submits, no history or status action", async () => {
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog("create", { onSubmit, onOpenChange });

    expect(screen.queryByRole("button", { name: "編輯紀錄" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停用客戶" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "建立" }));
    expect(onSubmit).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
