import { describe, it, expect } from "vitest";
import { formatDurationS, metersToMiles, formatDistanceMiles, formatActivityType } from "./format";

describe("formatDurationS", () => {
  it("handles minutes, hours, and empties", () => {
    expect(formatDurationS(1800)).toBe("30 min");
    expect(formatDurationS(3600)).toBe("1h");
    expect(formatDurationS(4320)).toBe("1h 12m");
    expect(formatDurationS(null)).toBe("—");
    expect(formatDurationS(0)).toBe("—");
  });
});

describe("metersToMiles / formatDistanceMiles", () => {
  it("converts and formats", () => {
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 6);
    expect(formatDistanceMiles(5000)).toBe("3.11 mi");
    expect(formatDistanceMiles(0)).toBe("—");
    expect(formatDistanceMiles(null)).toBe("—");
  });
});

describe("formatActivityType", () => {
  it("splits CamelCase and defaults", () => {
    expect(formatActivityType("TrailRun")).toBe("Trail Run");
    expect(formatActivityType("WeightTraining")).toBe("Weight Training");
    expect(formatActivityType("Run")).toBe("Run");
    expect(formatActivityType(null)).toBe("Activity");
  });
});
