import { describe, it, expect } from "vitest";
import { buildRunSlots } from "./slots";
import { compromisedLongDescription } from "./run-descriptions";

/**
 * Batch 5 (Finding 5): the Section 6 keystone — a long run threaded with station
 * transitions — is modeled as a named session via a `compromised` flag on the
 * long run slot, set only when the athlete gave an hours budget (compromisedLong).
 */
describe("compromised long run", () => {
  it("marks ONLY the long run as compromised when compromisedLong is set", () => {
    const slots = buildRunSlots("build", 4, undefined, "none", "full", true, true);
    const longs = slots.filter((s) => s.isLong);
    expect(longs).toHaveLength(1);
    expect(longs[0]!.compromised).toBe(true);
    // no non-long run is flagged
    expect(slots.filter((s) => !s.isLong).every((s) => !s.compromised)).toBe(true);
  });

  it("does not flag any run when compromisedLong is false (golden path)", () => {
    const slots = buildRunSlots("build", 4, undefined, "none", "full", true, false);
    expect(slots.some((s) => s.compromised)).toBe(false);
  });

  it("station-only (maintenance) weeks never seed a long run to flag", () => {
    const slots = buildRunSlots("build", 2, undefined, "none", "maintenance", true, true);
    expect(slots.every((s) => s.runType === "easy")).toBe(true);
    expect(slots.some((s) => s.compromised)).toBe(false);
  });

  it("exposes a distinct compromised-run description mentioning stations", () => {
    const d = compromisedLongDescription();
    expect(d.toLowerCase()).toContain("station");
    expect(d.toLowerCase()).toContain("compromised");
  });
});
