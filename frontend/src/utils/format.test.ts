import { describe, it, expect } from "vitest";
import { formatPercent } from "./format";

describe("formatPercent", () => {
  it("renders a ratio with no decimals", () => {
    expect(formatPercent(0.85, 0)).toBe("85");
  });

  it("renders a ratio with one decimal", () => {
    expect(formatPercent(0.8567, 1)).toBe("85.7");
  });

  it("renders a ratio with two decimals", () => {
    expect(formatPercent(0.123_456, 2)).toBe("12.35");
  });

  it("returns zero for a zero ratio", () => {
    expect(formatPercent(0, 1)).toBe("0.0");
  });

  it("keeps values above one unclamped", () => {
    expect(formatPercent(1.5, 0)).toBe("150");
  });

  it("carries the sign of a negative ratio", () => {
    expect(formatPercent(-0.25, 0)).toBe("-25");
  });
});
