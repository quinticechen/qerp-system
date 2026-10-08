import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox } from "./combobox";

// jsdom lacks the browser APIs cmdk measures and scrolls with
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

describe("Combobox", () => {
  it("finds options by the name shown, not by their id", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Combobox
        options={[
          { value: "0b6c1d2e-customer-a", label: "大東紡織" },
          { value: "7f3e9a10-customer-b", label: "聯華布業" },
        ]}
        value=""
        onValueChange={onValueChange}
        placeholder="選擇客戶..."
        searchPlaceholder="搜尋客戶..."
        emptyText="未找到客戶"
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByPlaceholderText("搜尋客戶..."), "聯華");

    expect(screen.queryByRole("option", { name: "大東紡織" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "聯華布業" }));
    expect(onValueChange).toHaveBeenCalledWith("7f3e9a10-customer-b");
  });
});
