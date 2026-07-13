import { describe, it, expect } from "vitest";
import {
  analyzeNeeds,
  applyPhaseBias,
  buildRunSlots,
  buildSkeleton,
  planWeek,
  NEUTRAL_BIAS,
  type EngineInput,
  type NeedsProfile,
} from "./index";

const baseProfile = (over: Partial<NeedsProfile> = {}): NeedsProfile => ({
  bodyWeight: 180,
  weightUnit: "lbs",
  runningExp: "intermediate",
  hybridExp: "intermediate",
  liftingExp: "intermediate",
  trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
  ...over,
});

describe("analyzeNeeds — data sufficiency", () => {
  it("no benchmarks ⇒ neutral bias, not informative, no limiters", () => {
    const n = analyzeNeeds(baseProfile());
    expect(n.informative).toBe(false);
    expect(n.limiters).toEqual([]);
    expect(n.bias).toEqual(NEUTRAL_BIAS);
  });

  it("a single scored domain is not enough to declare a limiter", () => {
    const n = analyzeNeeds(baseProfile({ benchmarks: { fiveKTime: "30:00" } }));
    expect(n.limiters).toEqual([]);
    // one run time, no second domain, no durability pair ⇒ neutral
    expect(n.bias).toEqual(NEUTRAL_BIAS);
  });
});

describe("analyzeNeeds — limiter detection + bias", () => {
  it("weak runner (strong strength/erg) ⇒ run_engine limiter: +1 run, aerobic, base+1/peak-1", () => {
    const n = analyzeNeeds(
      baseProfile({
        bodyWeight: 200,
        benchmarks: {
          fiveKTime: "34:00",
          tenKTime: "72:00",
          fiveRmSquat: 315,
          fiveRmDeadlift: 405,
          fiveRmBench: 225,
          row2kTime: "7:30",
          ski2kTime: "8:00",
          bike20MinCals: 300,
        },
      }),
    );
    expect(n.limiters).toContain("run_engine");
    expect(n.limiters).not.toContain("strength");
    expect(n.bias.runCountDelta).toBe(1);
    expect(n.bias.runEmphasis).toBe("aerobic");
    expect(n.bias.baseWeeksDelta).toBe(1);
    expect(n.bias.peakWeeksDelta).toBe(-1);
  });

  it("weak strength (strong runner) ⇒ strength limiter: strength stations, build+1/base-1", () => {
    const n = analyzeNeeds(
      baseProfile({
        bodyWeight: 160,
        benchmarks: {
          mileTime: "5:20",
          fiveKTime: "18:30",
          tenKTime: "38:30",
          fiveRmSquat: 155,
          fiveRmDeadlift: 205,
          fiveRmBench: 115,
          row2kTime: "8:00",
          ski2kTime: "8:30",
          bike20MinCals: 240,
        },
      }),
    );
    expect(n.limiters).toContain("strength");
    expect(n.bias.stationEmphasis[0]).toBe("sled push");
    expect(n.bias.buildWeeksDelta).toBe(1);
    expect(n.bias.baseWeeksDelta).toBe(-1);
    expect(n.bias.runCountDelta).toBe(0);
  });

  it("weak erg ⇒ erg limiter: +1 hybrid and erg stations first", () => {
    const n = analyzeNeeds(
      baseProfile({
        bodyWeight: 175,
        benchmarks: {
          fiveKTime: "20:00",
          tenKTime: "41:30",
          fiveRmSquat: 300,
          fiveRmDeadlift: 385,
          fiveRmBench: 205,
          row2kTime: "9:10",
          ski2kTime: "9:40",
          bike20MinCals: 165,
        },
      }),
    );
    expect(n.limiters).toContain("erg_engine");
    expect(n.bias.hybridCountDelta).toBe(1);
    expect(n.bias.stationEmphasis[0]).toBe("ski erg");
  });

  it("durability: 10K far slower than Riegel prediction ⇒ aerobic emphasis + base nudge, even with no 2nd domain", () => {
    const n = analyzeNeeds(baseProfile({ benchmarks: { fiveKTime: "20:00", tenKTime: "45:00" } }));
    expect(n.durability).toBe("low");
    expect(n.informative).toBe(true);
    expect(n.limiters).toEqual([]); // only running scored
    expect(n.bias.runEmphasis).toBe("aerobic");
    expect(n.bias.baseWeeksDelta).toBe(1);
    expect(n.bias.runCountDelta).toBe(0); // emphasis without a frequency change
  });

  it("two limiters on a 4-day schedule ⇒ combined added sessions capped at 1", () => {
    const n = analyzeNeeds(
      baseProfile({
        trainingDays: ["mon", "wed", "fri", "sun"],
        bodyWeight: 200,
        benchmarks: {
          fiveKTime: "34:00", // very weak run (more severe limiter)
          tenKTime: "72:00",
          row2kTime: "8:45", // weak erg, but less severe than the run
          ski2kTime: "9:00",
          bike20MinCals: 200,
          fiveRmSquat: 340,
          fiveRmDeadlift: 430,
          fiveRmBench: 235,
        },
      }),
    );
    expect(n.limiters).toEqual(expect.arrayContaining(["run_engine", "erg_engine"]));
    // run is the more severe limiter ⇒ its +1 run is kept, hybrid is dropped
    expect(n.bias.runCountDelta).toBe(1);
    expect(n.bias.hybridCountDelta).toBe(0);
  });
});

describe("applyPhaseBias — guards", () => {
  it("moves one week base+1/peak-1 when there is room", () => {
    const out = applyPhaseBias({ base: 9, build: 6, peak: 3 }, 18, {
      ...NEUTRAL_BIAS,
      baseWeeksDelta: 1,
      peakWeeksDelta: -1,
    });
    expect(out).toEqual({ base: 10, build: 6, peak: 2 });
  });

  it("never lets Base stop being the largest phase", () => {
    // base-1 would make base(5) < build(6): rejected, original returned
    const out = applyPhaseBias({ base: 6, build: 6, peak: 6 }, 18, {
      ...NEUTRAL_BIAS,
      baseWeeksDelta: -1,
      buildWeeksDelta: 1,
    });
    expect(out).toEqual({ base: 6, build: 6, peak: 6 });
  });

  it("no nudge on short programs (working < 8)", () => {
    const out = applyPhaseBias({ base: 3, build: 2, peak: 1 }, 6, {
      ...NEUTRAL_BIAS,
      baseWeeksDelta: 1,
      peakWeeksDelta: -1,
    });
    expect(out).toEqual({ base: 3, build: 2, peak: 1 });
  });
});

describe("slot-level effects", () => {
  it("runCountDelta adds a run on loading weeks, clamped ≤ 8", () => {
    const neutral = planWeek("base", "increase", "intermediate", "intermediate");
    const biased = planWeek("base", "increase", "intermediate", "intermediate", {
      ...NEUTRAL_BIAS,
      runCountDelta: 1,
    });
    expect(biased.runs).toBe(neutral.runs + 1);
  });

  it("frequency nudges do NOT apply on deload weeks", () => {
    const neutral = planWeek("base", "deload", "intermediate", "intermediate");
    const biased = planWeek("base", "deload", "intermediate", "intermediate", {
      ...NEUTRAL_BIAS,
      runCountDelta: 1,
      hybridCountDelta: 1,
    });
    expect(biased).toEqual(neutral);
  });

  it("aerobic emphasis fronts easy runs; threshold emphasis fronts a quality run", () => {
    const aerobic = buildRunSlots("build", 3, { index: 0, length: 6 }, "aerobic");
    // slot 0 is always the long run; slot 1 should be easy under aerobic emphasis
    expect(aerobic[1]!.runType).toBe("easy");
    const threshold = buildRunSlots("build", 3, { index: 0, length: 6 }, "threshold");
    expect(["tempo", "threshold", "interval"]).toContain(threshold[1]!.runType);
  });

  it("default emphasis leaves run-type order unchanged", () => {
    const a = buildRunSlots("build", 5, { index: 0, length: 6 });
    const b = buildRunSlots("build", 5, { index: 0, length: 6 }, "none");
    expect(a.map((r) => r.runType)).toEqual(b.map((r) => r.runType));
  });
});

describe("buildSkeleton integration", () => {
  const engine = (needsProfile?: NeedsProfile): EngineInput => ({
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    programType: "goal_event",
    durationWeeks: 20,
    trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
    races: [{ weekNumber: 20, priority: "A" }],
    needs: needsProfile ? analyzeNeeds(needsProfile) : undefined,
  });

  it("neutral (no benchmarks) keeps the original allocation", () => {
    const s = buildSkeleton(engine(baseProfile()));
    expect(s.allocation).toEqual({ base: 9, build: 6, peak: 3, taper: 2 });
  });

  it("run-limited athlete shifts a week from peak into base", () => {
    const s = buildSkeleton(
      engine(
        baseProfile({
          bodyWeight: 200,
          benchmarks: {
            fiveKTime: "34:00",
            tenKTime: "72:00",
            fiveRmSquat: 315,
            fiveRmDeadlift: 405,
            fiveRmBench: 225,
            row2kTime: "7:30",
            ski2kTime: "8:00",
            bike20MinCals: 300,
          },
        }),
      ),
    );
    expect(s.allocation).toEqual({ base: 10, build: 6, peak: 2, taper: 2 });
    expect(s.needs?.limiters).toContain("run_engine");
  });
});


describe("sex-adjusted anchors (Review #10)", () => {
  const benchmarks = { row2kTime: "9:00", ski2kTime: "9:20", bike20MinCals: 170,
    fiveRmSquat: 175, fiveRmDeadlift: 235, fiveRmBench: 120 };

  it("scores erg + strength against sex norms (female not penalized vs male anchors)", () => {
    const male = analyzeNeeds(baseProfile({ sex: "male", bodyWeight: 150, benchmarks }));
    const female = analyzeNeeds(baseProfile({ sex: "female", bodyWeight: 150, benchmarks }));
    expect((female.domainScores.erg_engine ?? 0)).toBeGreaterThan(male.domainScores.erg_engine ?? 0);
    expect((female.domainScores.strength ?? 0)).toBeGreaterThan(male.domainScores.strength ?? 0);
  });

  it("no sex (or 'other') uses male anchors — unchanged from before", () => {
    const none = analyzeNeeds(baseProfile({ bodyWeight: 150, benchmarks }));
    const male = analyzeNeeds(baseProfile({ sex: "male", bodyWeight: 150, benchmarks }));
    expect(none.domainScores).toEqual(male.domainScores);
  });
});
