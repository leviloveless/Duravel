import { describe, it, expect } from "vitest";
import { centsToUsd, formatUsd, progressPct, remainingCents, dollarsToCents } from "./fundraiser";

describe("fundraiser math", () => {
  it("progressPct clamps 0-100 and handles no goal", () => {
    expect(progressPct(2500, 10000)).toBe(25);
    expect(progressPct(15000, 10000)).toBe(100);
    expect(progressPct(-5, 10000)).toBe(0);
    expect(progressPct(500, 0)).toBe(0);
  });
  it("remainingCents never negative", () => {
    expect(remainingCents(3000, 10000)).toBe(7000);
    expect(remainingCents(12000, 10000)).toBe(0);
  });
  it("centsToUsd + formatUsd", () => {
    expect(centsToUsd(123456)).toBe(1234.56);
    expect(formatUsd(123456)).toBe("$1,235");
    expect(formatUsd(0)).toBe("$0");
  });
  it("dollarsToCents parses $ , and rejects junk", () => {
    expect(dollarsToCents("$1,234.56")).toBe(123456);
    expect(dollarsToCents("500")).toBe(50000);
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("-5")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
  });
});
