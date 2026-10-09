import { describe, expect, it } from "vitest";
import { arrivalDatesOf, lastArrivalDate } from "./purchaseArrivals";

const receipts = [
  { arrival_date: "2026-10-05", receipt_number: "I1", inventory_rolls: [{ product_id: "white" }, { product_id: "black" }] },
  { arrival_date: "2026-10-09", receipt_number: "I2", inventory_rolls: [{ product_id: "white" }] },
  { arrival_date: "2026-10-05", receipt_number: "I3", inventory_rolls: [{ product_id: "white" }] },
];

describe("purchase arrivals", () => {
  it("finds the latest arrival", () => {
    expect(lastArrivalDate(receipts)).toBe("2026-10-09");
    expect(lastArrivalDate([])).toBeNull();
  });

  it("lists each date a product arrived, once and in order", () => {
    expect(arrivalDatesOf(receipts, "white")).toEqual(["2026-10-05", "2026-10-09"]);
    expect(arrivalDatesOf(receipts, "black")).toEqual(["2026-10-05"]);
    expect(arrivalDatesOf(receipts, "red")).toEqual([]);
  });
});
