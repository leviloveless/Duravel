import { describe, it, expect } from "vitest";
import { buildRunSlots } from "./slots";
import { hybridDescription, runDescription } from "./run-descriptions";

/**
 * Long runs are programmed as plain aerobic long runs (no stations threaded in).
 * "Compromised running" is trained in the HYBRID sessions, and its explanation
 * is surfaced there (what it is, why it is programmed, how the station-to-run
 * format builds it) — never on the long run.
 */
describe("long runs stay plain; compromised running lives on hybrids", () => {
  it("never marks a long run as compromised", () => {
    const slots = buildRunSlots("build", 5, undefined, "none", "full", true);
    const longs = slots.filter((s) => s.isLong);
    expect(longs).toHaveLength(1);
    expect(slots.every((s) => !("compromised" in s))).toBe(true);
  });

  it("describes the long run as a straightforward aerobic long run (no stations)", () => {
    const d = runDescription("long", "intermediate").toLowerCase();
    expect(d).not.toContain("station");
    expect(d).not.toContain("compromised");
  });

  it("explains compromised running on the hybrid session (what + why + how)", () => {
    const d = hybridDescription().toLowerCase();
    expect(d).toContain("compromised running");
    expect(d).toContain("station");
    expect(d).toContain("fatigued");
  });
});
