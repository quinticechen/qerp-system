import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumberInput } from "./NumberInput";

const Harness = ({ decimals }: { decimals?: number }) => {
  const [value, setValue] = useState("");
  return <NumberInput aria-label="數量" value={value} onValueChange={setValue} decimals={decimals} />;
};

describe("NumberInput", () => {
  it("starts empty and keeps only a number", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "數量" });

    expect(input).toHaveValue("");
    await user.type(input, "12a.5-6x7");
    expect(input).toHaveValue("12.56");
  });

  it("can be cleared completely", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "數量" });

    await user.type(input, "30");
    await user.clear(input);
    expect(input).toHaveValue("");
  });

  it("accepts whole numbers only when decimals is 0", async () => {
    const user = userEvent.setup();
    render(<Harness decimals={0} />);
    const input = screen.getByRole("textbox", { name: "數量" });

    await user.type(input, "4.5");
    expect(input).toHaveValue("45");
  });
});

describe("NumberInput with a numeric value", () => {
  const NumericHarness = ({ max }: { max?: number }) => {
    const [value, setValue] = useState(0);
    return (
      <>
        <NumberInput aria-label="重量" value={value} onValueChange={(text) => setValue(Math.min(parseFloat(text) || 0, max ?? Infinity))} />
        <output aria-label="數值">{value}</output>
      </>
    );
  };

  it("shows 0 as empty and lets decimals be typed", async () => {
    const user = userEvent.setup();
    render(<NumericHarness />);
    const input = screen.getByRole("textbox", { name: "重量" });

    expect(input).toHaveValue("");
    await user.type(input, "12.5");
    expect(input).toHaveValue("12.5");
    expect(screen.getByLabelText("數值")).toHaveTextContent("12.5");
  });

  it("follows the value when the parent changes it", async () => {
    const user = userEvent.setup();
    render(<NumericHarness max={40} />);
    const input = screen.getByRole("textbox", { name: "重量" });

    await user.type(input, "55");
    expect(input).toHaveValue("40");
  });
});
