/**
 * A HYBRID IS THE WEEK'S THRESHOLD SESSION (Levi, 2026-08-13).
 *
 * Once hybrids became race-structure sessions (all 8 stations, each behind a
 * full 1000 m run at race pace) each one carries ~5 miles of threshold running,
 * and every one of those miles counts against the week's mileage target. The
 * engine kept scheduling a separate threshold run on top, so the week paid for
 * the same stimulus twice — out of its easy running, because that is the only
 * thing left to shrink.
 *
 * A 192-week sweep across every band × experience level, before the fix:
 *
 *     hard (threshold or harder)  39.1% of weekly mileage
 *       - of which inside hybrids  20.8%
 *       - of which quality runs    18.3%
 *     easy                          8.2%     ← the problem
 *     weeks over 30% hard        166/192
 *
 * After: hard 31.1% (quality runs 18.3% → 10.3%), easy 8.2% → 19.6%, weeks over
 * 30% hard 166 → 116. The residual 20.8% is the hybrid itself, which is Levi's
 * deliberate design choice — full-distance runs between stations — not drift.
 *
 * The rule is a SUBSTITUTION, not a cut: the hybrid credits the THRESHOLD
 * anchor only. The interval survives, because VO2 work is a stimulus steady
 * race-pace running does not provide at any volume.
 */
import { describe, it, expect } from "vitest";
import { buildRunSlots } from "./slots";
import type { RunSlot } from "./types";

const types = (slots: RunSlot[]) => slots.map((s) => s.runType);

describe("a hybrid credits the week's threshold run", () => {
  it("drops the threshold anchor when the week carries a hybrid", () => {
    const without = buildRunSlots("build", 4, undefined, "none", "full", true, 0);
    const with1 = buildRunSlots("build", 4, undefined, "none", "full", true, 1);

    expect(types(without)).toContain("threshold");
    expect(types(with1)).not.toContain("threshold");
  });

  it("keeps the interval — VO2 is not what a hybrid trains", () => {
    for (const hybrids of [0, 1, 2, 3]) {
      const slots = buildRunSlots("build", 4, undefined, "none", "full", true, hybrids);
      expect(types(slots), `${hybrids} hybrids`).toContain("interval");
    }
  });

  it("always keeps exactly one long run, whatever the credit", () => {
    for (const hybrids of [0, 1, 2]) {
      const slots = buildRunSlots("peak", 5, undefined, "none", "full", true, hybrids);
      expect(
        slots.filter((s) => s.isLong),
        `${hybrids} hybrids`,
      ).toHaveLength(1);
    }
  });

  it("does not change how MANY runs the week gets — only what they are", () => {
    for (const count of [2, 3, 4, 5, 6]) {
      const a = buildRunSlots("build", count, undefined, "none", "full", true, 0);
      const b = buildRunSlots("build", count, undefined, "none", "full", true, 2);
      expect(b, `count ${count}`).toHaveLength(a.length);
    }
  });

  it("spends the freed slot on EASY running, not another quality session", () => {
    // The filler pool offers tempo/interval in build and peak, so without the
    // aerobic re-ordering the credited threshold run simply comes back as a
    // tempo — the fix would look like it worked and change nothing.
    const with2 = buildRunSlots("peak", 5, undefined, "none", "full", true, 2);
    const hard = types(with2).filter((t) => t === "threshold" || t === "tempo");
    expect(hard).toHaveLength(0);
    expect(types(with2).filter((t) => t === "easy").length).toBeGreaterThan(0);
  });

  it("an EXPLICIT threshold bias still wins — preferences beat defaults", () => {
    // The repo's standing rule. An athlete whose needs analysis says they are
    // threshold-limited keeps their threshold work even in a hybrid week.
    const slots = buildRunSlots("build", 5, undefined, "threshold", "full", true, 2);
    const quality = types(slots).filter(
      (t) => t === "threshold" || t === "tempo" || t === "interval",
    );
    expect(quality.length).toBeGreaterThan(1);
  });

  it("leaves LEGACY no-band programs completely alone", () => {
    // `guaranteeQuality: false` is the legacy path — every golden-HYROX fixture
    // predates weekly-hours bands and takes it. The credit must never fire
    // there, or the P0 oracle moves.
    for (const phase of ["base", "build", "peak", "taper"] as const) {
      for (const count of [3, 4, 5]) {
        const a = buildRunSlots(phase, count, undefined, "none", "full", false, 0);
        const b = buildRunSlots(phase, count, undefined, "none", "full", false, 3);
        expect(types(b), `${phase}/${count}`).toEqual(types(a));
      }
    }
  });

  it("leaves station-only (maintenance) sports alone", () => {
    // DEKA Strong/Atlas keep their few runs as easy Z2 maintenance regardless.
    const a = buildRunSlots("build", 3, undefined, "none", "maintenance", true, 0);
    const b = buildRunSlots("build", 3, undefined, "none", "maintenance", true, 2);
    expect(types(b)).toEqual(types(a));
    expect(types(b).every((t) => t === "easy")).toBe(true);
  });
});
