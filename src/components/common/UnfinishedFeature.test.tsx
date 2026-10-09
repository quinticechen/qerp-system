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

  it("labels a short value inline outside production, and hides it in production", () => {
    environment.showUnfinished = true;
    const { unmount } = render(
      <UnfinishedFeature variant="inline">
        <span>+12% 較上月</span>
      </UnfinishedFeature>,
    );
    expect(screen.getByText("+12% 較上月")).toBeInTheDocument();
    expect(screen.getByTitle("尚未實作")).toHaveTextContent("尚未實作");
    unmount();

    environment.showUnfinished = false;
    render(
      <UnfinishedFeature variant="inline">
        <span>+12% 較上月</span>
      </UnfinishedFeature>,
    );
    expect(screen.queryByText("+12% 較上月")).not.toBeInTheDocument();
  });
});
