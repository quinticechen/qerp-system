import { describe, expect, it } from "vitest";
import { todayInTaiwan } from "./dates";

describe("todayInTaiwan", () => {
  it("gives Taiwan's date even when UTC is still on the previous day", () => {
    // 01:02 on 9 October in Taiwan is 17:02 on 8 October in UTC
    expect(todayInTaiwan(new Date("2026-10-08T17:02:00Z"))).toBe("2026-10-09");
  });

  it("gives the same date during Taiwan's daytime", () => {
    expect(todayInTaiwan(new Date("2026-10-09T04:00:00Z"))).toBe("2026-10-09");
  });
});
