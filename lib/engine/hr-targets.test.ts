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
import { hrTargetLines, repPeakBpm, stripHrLines, withHrLines, HR_LINE_PREFIX } from "./hr-targets";
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
const perRepLine = (ls: string[]) => ls.find((l) => l.startsWith(`${HR_LINE_PREFIX}by rep`));

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

describe("each rep gets its own estimated peak", () => {
  const band = (model: typeof MODEL, zone: 4 | 5) => zoneBpmRange(model, zone);

  it("lists one figure per rep, in order", () => {
    const l = perRepLine(lines({ reps: 5 }));
    expect(l).toContain("1 ~");
    expect(l).toContain("5 ~");
    expect(repPeakBpm(MODEL, 5, "interval", 5)).toHaveLength(5);
  });

  it("climbs — no rep peaks lower than the one before it", () => {
    for (const [runType, zone] of [
      ["interval", 5],
      ["threshold", 4],
    ] as const) {
      for (const reps of [2, 3, 4, 5, 6, 8]) {
        const peaks = repPeakBpm(MODEL, zone, runType, reps);
        for (let i = 1; i < peaks.length; i++) {
          expect(peaks[i]!, `${runType} ${reps} reps, rep ${i + 1}`).toBeGreaterThanOrEqual(
            peaks[i - 1]!,
          );
        }
      }
    }
  });

  it("puts rep 1 BELOW the band — the thing the flat band was hiding", () => {
    for (const [runType, zone] of [
      ["interval", 5],
      ["threshold", 4],
    ] as const) {
      const peaks = repPeakBpm(MODEL, zone, runType, 4);
      expect(peaks[0]!, runType).toBeLessThan(band(MODEL, zone).min);
    }
  });

  it("flattens INSIDE the band, never at max HR", () => {
    // A session whose last rep touches max was raced, not run.
    for (const reps of [4, 6, 10]) {
      const peaks = repPeakBpm(MODEL, 5, "interval", reps);
      const last = peaks[peaks.length - 1]!;
      expect(last).toBeGreaterThan(band(MODEL, 5).min);
      expect(last).toBeLessThan(MODEL.maxHR);
    }
  });

  it("reaches the band sooner on threshold reps than on interval reps", () => {
    // A 1-mile rep lasts long enough for HR to arrive; a 1 km rep ends first.
    const shortfall = (runType: "interval" | "threshold", zone: 4 | 5) => {
      const b = band(MODEL, zone);
      return (b.min - repPeakBpm(MODEL, zone, runType, 4)[0]!) / (b.max - b.min);
    };
    expect(shortfall("threshold", 4)).toBeLessThan(shortfall("interval", 5));
  });

  it("is the athlete's own band, not a fixed %HRmax", () => {
    const friel = resolveHrModel({ age: 35, sex: "male", thresholdHr: 172 });
    const karvonen = resolveHrModel({ age: 35, sex: "male", restingHr: 48 });
    expect(friel.maxHR).toBe(karvonen.maxHR); // same max...
    expect(repPeakBpm(friel, 4, "threshold", 3)).not.toEqual(
      repPeakBpm(karvonen, 4, "threshold", 3),
    ); // ...different bands, different estimates
  });

  it("never exceeds max HR, whatever the bands say", () => {
    const silly = {
      maxHR: 180,
      bands: { ...MODEL.bands, 5: { low: 0.98, high: 1.4 } },
    };
    for (const bpm of repPeakBpm(silly, 5, "interval", 6)) expect(bpm).toBeLessThanOrEqual(180);
  });

  it("degrades to a flat figure on a zero-width band rather than dividing by it", () => {
    const flat = { maxHR: 180, bands: { ...MODEL.bands, 5: { low: 0.9, high: 0.9 } } };
    expect(repPeakBpm(flat, 5, "interval", 3)).toEqual([162, 162, 162]);
  });

  it("is omitted for a single rep — there is no climb to describe", () => {
    expect(perRepLine(lines({ reps: 1 }))).toBeUndefined();
  });

  it("is omitted for run types with no reps", () => {
    expect(repPeakBpm(MODEL, 3, "tempo", 3)).toEqual([]);
    expect(repPeakBpm(MODEL, 2, "long", 3)).toEqual([]);
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
    // Exactly one set — not the first model's lines plus the second's.
    expect(twice.split("\n").filter((l) => l.startsWith(HR_LINE_PREFIX))).toHaveLength(
      lines({ model: ALT }).length,
    );
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
