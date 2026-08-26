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

/** A 35-year-old man with a measured resting HR — anchors on HRR (Karvonen). */
const MODEL = resolveHrModel({ age: 35, sex: "male", restingHr: 50 });
/** A visibly different athlete, for proving one model's numbers replace another's.
 *  (At 35/male the HRR and %HRmax models happen to agree on Zone 5's floor to the
 *  bpm — a coincidence that would make a replacement test pass either way.) */
const ALT = resolveHrModel({ age: 22, sex: "female" });

const lines = (over: Partial<Parameters<typeof hrTargetLines>[0]> = {}) =>
  hrTargetLines({ runType: "interval", goalZone: 5, model: MODEL, reps: 5, ...over });

const repLine = (ls: string[]) => ls.find((l) => l.startsWith(`${HR_LINE_PREFIX}reps:`));
const jogLine = (ls: string[]) => ls.find((l) => l.startsWith(`${HR_LINE_PREFIX}recovery jogs:`));

describe("the reps line", () => {
  it("names the first rep's end and the last rep's end, and nothing else", () => {
    // Levi, 2026-08-25: "HR reps: 165 by the end of rep 1 - 185 by the end of rep 5".
    const peaks = repPeakBpm(MODEL, 5, "interval", 5);
    expect(repLine(lines())).toBe(
      `HR reps: ${peaks[0]} by the end of rep 1 - ${peaks[4]} by the end of rep 5`,
    );
  });

  it("counts the reps the session actually has", () => {
    expect(repLine(lines({ reps: 3 }))).toContain("end of rep 3");
    expect(repLine(lines({ reps: 6 }))).toContain("end of rep 6");
  });

  it("collapses to one figure when there is a single rep", () => {
    expect(repLine(lines({ reps: 1 }))).toContain("by the end of the rep");
    expect(repLine(lines({ reps: 1 }))).not.toContain("rep 1 -");
  });

  it("carries no zone label, band or coaching sentence — those moved out", () => {
    const l = repLine(lines())!;
    expect(l).not.toMatch(/Zone/i);
    expect(l).not.toMatch(/bpm/);
    expect(l).not.toMatch(/back half|do not chase|normal/i);
  });

  it("says nothing about estimates — the glossary carries that now", () => {
    expect(lines().some((l) => /estimate/i.test(l))).toBe(false);
  });

  it("gives threshold its own numbers", () => {
    const peaks = repPeakBpm(MODEL, 4, "threshold", 3);
    expect(repLine(lines({ runType: "threshold", goalZone: 4, reps: 3 }))).toBe(
      `HR reps: ${peaks[0]} by the end of rep 1 - ${peaks[2]} by the end of rep 3`,
    );
  });
});

describe("the per-rep ramp behind those two figures", () => {
  const band = (model: typeof MODEL, zone: 4 | 5) => zoneBpmRange(model, zone);

  it("computes one figure per rep, in order", () => {
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

  it("is omitted for run types with no reps", () => {
    expect(repPeakBpm(MODEL, 3, "tempo", 3)).toEqual([]);
    expect(repPeakBpm(MODEL, 2, "long", 3)).toEqual([]);
  });
});

describe("the recovery-jog line", () => {
  it("is a single drop-below figure", () => {
    expect(jogLine(lines())).toBe(
      `HR recovery jogs: heart rate should drop below ${zoneBpmRange(MODEL, 2).max}`,
    );
  });

  it("uses the top of Zone 2 under every anchoring method", () => {
    for (const model of [
      resolveHrModel({ age: 28, sex: "female" }),
      resolveHrModel({ age: 45, sex: "male", restingHr: 48 }),
      resolveHrModel({ age: 38, sex: "male", thresholdHr: 172 }),
    ]) {
      expect(jogLine(lines({ model }))).toContain(`below ${zoneBpmRange(model, 2).max}`);
    }
  });

  it("is present even on a single-rep session — the jog before/after still counts", () => {
    expect(jogLine(lines({ reps: 1 }))).toBeDefined();
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
    expect(repLine(lines({ model: ALT }))).not.toBe(repLine(lines()));
    expect(twice).toContain(repLine(lines({ model: ALT }))!);
    expect(twice).not.toContain(repLine(lines())!);
  });

  it("returns just the lines when there is no description to attach them to", () => {
    expect(withHrLines("", lines())).toBe(lines().join("\n"));
  });
});

describe("the numbers follow the athlete's own zone model", () => {
  // Two athletes with the SAME max HR and different anchoring must not be handed
  // the same bpm — that was the whole point of routing through `zoneBpmRange`.
  const models = [
    resolveHrModel({ age: 35, sex: "male" }),
    resolveHrModel({ age: 35, sex: "male", restingHr: 48 }),
    resolveHrModel({ age: 35, sex: "male", thresholdHr: 172 }),
  ];

  it("gives the same max HR different reps lines under different anchors", () => {
    const rendered = new Set(models.map((model) => repLine(lines({ model }))!));
    expect(models.every((m) => m.maxHR === models[0]!.maxHR)).toBe(true);
    expect(rendered.size).toBeGreaterThan(1);
  });

  it("keeps every printed figure inside the athlete's physiology", () => {
    for (const model of models) {
      for (const bpm of repPeakBpm(model, 5, "interval", 5)) {
        expect(bpm).toBeLessThanOrEqual(model.maxHR);
        expect(bpm).toBeGreaterThan(zoneBpmRange(model, 2).max);
      }
    }
  });
});
