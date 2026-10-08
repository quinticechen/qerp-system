import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnfinishedFeature } from "./UnfinishedFeature";

const environment = vi.hoisted(() => ({ showUnfinished: true }));

vi.mock("@/lib/appEnvironment", () => ({
  get SHOW_UNFINISHED_FEATURES() {
    return environment.showUnfinished;
  },
}));

const renderFeature = () =>
  render(
    <UnfinishedFeature>
      <div>
        <label htmlFor="smtp">SMTP 伺服器</label>
        <input id="smtp" />
      </div>
    </UnfinishedFeature>,
  );

describe("UnfinishedFeature", () => {
  it("hides the feature in production", () => {
    environment.showUnfinished = false;
    renderFeature();

    expect(screen.queryByLabelText("SMTP 伺服器")).not.toBeInTheDocument();
    expect(screen.queryByText("尚未實作")).not.toBeInTheDocument();
  });

  it("shows the feature greyed out and disabled outside production", () => {
    environment.showUnfinished = true;
    renderFeature();

    expect(screen.getByText("尚未實作")).toBeInTheDocument();
    expect(screen.getByLabelText("SMTP 伺服器")).toBeDisabled();
    expect(screen.getByRole("group", { name: "尚未實作的功能" })).toHaveClass("[&>*]:bg-gray-100");
  });
});
