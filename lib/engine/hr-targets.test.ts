/**
 * HR TARGETS FOR REP-BASED QUALITY RUNS (Levi, 2026-08-25).
 *
 * "The workouts should prescribe heart rate ranges per rep when I'm doing
 * threshold and interval workouts with multiple reps. There should also be
 * prescribed heart rate ranges for the recovery jog periods."
 *
 * The two things worth guarding are not the wording but the arithmetic: that a
 * session's bpm figures come from the same band table as the Zone chip beside
 * them, and that re-applying the lines to a stored description REPLACES them
 * instead of stacking a second copy (the program view rebuilds them on every
 * render).
 */
import { describe, it, expect } from "vitest";
import { hrTargetLines, stripHrLines, withHrLines, HR_LINE_PREFIX } from "./hr-targets";
import { resolveHrModel, zoneBpmRange } from "@/lib/zones";
import { zoneHrRange } from "@/components/program/format";

/** A 35-year-old man with a measured resting HR — anchors on HRR (Karvonen). */
const MODEL = resolveHrModel({ age: 35, sex: "male", restingHr: 50 });
/** Same athlete with nothing on file at all — bands are generic %HRmax. */
const ESTIMATED = resolveHrModel({ age: 35, sex: "male" });
/** A visibly different athlete, for proving one model's numbers replace another's.
 *  (At 35/male the HRR and %HRmax models happen to agree on Zone 5's floor to the
 *  bpm — a coincidence that would make a replacement test pass either way.) */
const ALT = resolveHrModel({ age: 22, sex: "female" });

const lines = (over: Partial<Parameters<typeof hrTargetLines>[0]> = {}) =>
  hrTargetLines({ runType: "interval", goalZone: 5, model: MODEL, reps: 5, ...over });

const repLine = (ls: string[]) => ls.find((l) => l.startsWith(`${HR_LINE_PREFIX}reps:`));
const jogLine = (ls: string[]) => ls.find((l) => l.startsWith(`${HR_LINE_PREFIX}recovery jog:`));

describe("the reps get a heart-rate range", () => {
  it("states the session's goal zone and its bpm band", () => {
    const l = repLine(lines());
    expect(l).toContain("Zone 5");
    expect(l).toContain(`${zoneBpmRange(MODEL, 5).min}+ bpm`);
  });

  it("gives threshold its own zone and a closed band", () => {
    const l = repLine(lines({ runType: "threshold", goalZone: 4 }));
    const { min, max } = zoneBpmRange(MODEL, 4);
    expect(l).toContain("Zone 4");
    expect(l).toContain(`${min}–${max} bpm`);
  });

  it("reads as a back-half target on intervals, because HR lags the work", () => {
    // The failure this prevents: an athlete treating a low rep 1 as a miss and
    // fixing it with pace, which is the one mistake the workout is built around.
    expect(repLine(lines())).toContain("back half");
    expect(repLine(lines())).toMatch(/rep 1 reads low/i);
  });
});

describe("the recovery jog gets a target too", () => {
  it("is a ceiling to fall below, at the top of Zone 2", () => {
    const l = jogLine(lines());
    expect(l).toContain(`below ${zoneBpmRange(MODEL, 2).max} bpm`);
    expect(l).toContain("top of Zone 2");
  });

  it("says what it means when the HR does NOT come down", () => {
    expect(jogLine(lines())).toMatch(/reps are too fast/i);
  });

  it("is omitted on a single-rep session — there is no 'between reps'", () => {
    expect(jogLine(lines({ reps: 1 }))).toBeUndefined();
    expect(repLine(lines({ reps: 1 }))).toBeDefined();
  });
});

describe("what does NOT get HR lines", () => {
  it("skips run types that have no reps", () => {
    for (const runType of ["easy", "long", "tempo", "fartlek", "progression"] as const) {
      expect(lines({ runType }), runType).toEqual([]);
    }
  });

  it("skips an athlete with no resolvable model", () => {
    expect(lines({ model: null })).toEqual([]);
    expect(lines({ model: undefined })).toEqual([]);
  });

  it("skips a goal zone outside 1–5 rather than inventing a band", () => {
    expect(lines({ goalZone: 0 })).toEqual([]);
    expect(lines({ goalZone: 7 })).toEqual([]);
  });
});

describe("the estimate nudge", () => {
  it("is added only when the numbers rest on an age estimate", () => {
    const withNudge = lines({ model: ESTIMATED, estimated: true });
    expect(withNudge.some((l) => l.includes("age-based max-HR estimate"))).toBe(true);
    expect(withNudge.some((l) => l.includes("resting or threshold HR"))).toBe(true);
  });

  it("is absent for an athlete who already supplied HR data", () => {
    expect(lines().some((l) => l.includes("estimate"))).toBe(false);
  });
});

describe("baked lines never become a second source of truth", () => {
  const base = "Warm up: 15 min easy\nWork: 5 x 1km\nCooldown: 10 min easy";

  it("strips only the HR lines", () => {
    expect(stripHrLines(withHrLines(base, lines()))).toBe(base);
  });

  it("leaves text that has no HR lines untouched", () => {
    expect(stripHrLines(base)).toBe(base);
  });

  it("REPLACES rather than appends when applied twice", () => {
    const once = withHrLines(base, lines());
    const twice = withHrLines(once, lines({ model: ALT }));
    expect(twice.split("\n").filter((l) => l.startsWith(HR_LINE_PREFIX))).toHaveLength(2);
    // ...and the numbers are the SECOND model's, not the first's.
    expect(zoneBpmRange(ALT, 5).min).not.toBe(zoneBpmRange(MODEL, 5).min);
    expect(twice).toContain(`${zoneBpmRange(ALT, 5).min}+ bpm`);
    expect(twice).not.toContain(`${zoneBpmRange(MODEL, 5).min}+ bpm`);
  });

  it("returns just the lines when there is no description to attach them to", () => {
    expect(withHrLines("", lines())).toBe(lines().join("\n"));
  });
});

describe("the HR line and the Zone chip agree", () => {
  // The divergence shape this repo keeps hitting: two surfaces computing the
  // same number their own way. Both go through `formatZoneBpm` — this is the
  // test that fails if one of them stops.
  const cases = [
    resolveHrModel({ age: 28, sex: "female" }),
    resolveHrModel({ age: 45, sex: "male", restingHr: 48 }),
    resolveHrModel({ age: 38, sex: "male", thresholdHr: 172 }),
    resolveHrModel({ age: 52, sex: "female", maxHr: 181, restingHr: 55 }),
  ];
  for (const model of cases) {
    it(`matches the chip under ${model.method}`, () => {
      for (const [runType, zone] of [
        ["interval", 5],
        ["threshold", 4],
      ] as const) {
        const l = repLine(hrTargetLines({ runType, goalZone: zone, model, reps: 4 }))!;
        expect(l).toContain(zoneHrRange(zone, model.maxHR, model.bands));
      }
      // The jog ceiling is the same Zone 2 top the chip would print.
      const jog = jogLine(hrTargetLines({ runType: "interval", goalZone: 5, model, reps: 4 }))!;
      expect(jog).toContain(`${zoneBpmRange(model, 2).max} bpm`);
    });
  }
});
