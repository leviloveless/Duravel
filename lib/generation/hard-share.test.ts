/**
 * The hard-running cap on hybrid weeks (Levi, 2026-09-28). See ./hard-share.ts.
 *
 * Measured with the same deterministic pipeline across 2,160 weeks (three hour
 * bands × experience × 4/5/6 days × five starting mileages): hard share 29.3% →
 * 23.4% on average, weeks over 30% 50% → 13% (what remains is almost all the
 * peak race-simulation weeks, which are exempt), and the interval count did not
 * move (769 → 769). The end-to-end block below pins the properties that sweep
 * rests on, through the real `buildSkeleton` + `assembleProgram` seam.
 */
import { describe, expect, it } from "vitest";
import type { GenerationInput, ProgramDay } from "@/lib/schemas";
import type { WeekSkeleton } from "@/lib/engine/types";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { assembleProgram } from "./assemble";
import { weekMileage } from "@/lib/session-volume";
import {
  HARD_RUNNING_SHARE_CAP,
  currentLegMeters,
  hardCapApplies,
  legMetersForCap,
  prunedToSurvivors,
  weekHardMiles,
  weekHardShare,
  withOneQualityRunEased,
} from "./hard-share";

const run = (runType: string, distanceMiles: number) =>
  ({
    kind: "run",
    runType,
    durationMin: 0,
    paceMinMile: "",
    distanceMiles,
    goalZone: 3,
  }) as const;
const hybrid = (legs: number, meters: number, simulation = false) => ({
  kind: "hybrid" as const,
  goalZone: 4,
  elements: Array.from({ length: legs }, () => ({
    exercise: "Run",
    prescription: `${meters}m @ race pace (threshold)`,
  })),
  ...(simulation ? { simulation: true } : {}),
});
const days = (...sessions: unknown[]) => [{ day: "mon", sessions }] as unknown as ProgramDay[];

describe("what counts as hard", () => {
  it("threshold, tempo and interval work miles, plus every hybrid leg", () => {
    const d = days(
      run("threshold", 3),
      run("interval", 2),
      run("easy", 5),
      run("long", 8),
      hybrid(4, 1000),
    );
    expect(weekHardMiles(d)).toBeCloseTo(3 + 2 + (4 * 1000) / 1609.344, 2);
    expect(weekHardShare(d)).toBeCloseTo(weekHardMiles(d) / weekMileage({ days: d }), 5);
  });
  it("applies only to a week with a regular hybrid, and never to the race simulation", () => {
    expect(hardCapApplies(days(run("threshold", 5), run("easy", 3)))).toBe(false);
    expect(hardCapApplies(days(hybrid(8, 1000)))).toBe(true);
    expect(hardCapApplies(days(hybrid(8, 1000), hybrid(8, 1000, true)))).toBe(false);
  });
});

describe("the levers", () => {
  const skel = {
    weekNumber: 1,
    phase: "base",
    microWeek: "increase",
    targetMileage: 18,
    targetCardioMinutes: 0,
    zoneTargets: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
    days: [
      {
        day: "mon",
        sessions: [
          { kind: "run", runType: "interval", goalZone: 5 },
          { kind: "run", runType: "threshold", goalZone: 4 },
        ],
      },
      {
        day: "sat",
        sessions: [
          { kind: "run", runType: "long", goalZone: 2, isLong: true },
          { kind: "run", runType: "easy", goalZone: 2 },
          { kind: "run", runType: "fartlek", goalZone: 3 },
        ],
      },
    ],
  } as unknown as WeekSkeleton;

  it("eases threshold/tempo runs one at a time, never an interval or the long run", () => {
    const once = withOneQualityRunEased(skel)!;
    const types = once.days.flatMap((d) =>
      d.sessions.map((s) => (s.kind === "run" ? s.runType : s.kind)),
    );
    expect(types).toEqual(["interval", "easy", "long", "easy", "fartlek"]);
    expect(withOneQualityRunEased(once)).toBeNull();
    // The original is untouched — the pipeline keeps the planned week.
    expect(skel.days[0]!.sessions[1]).toMatchObject({ runType: "threshold" });
  });

  it("prunes hard runs the reconciler dropped, but keeps easy runs as places for the miles to go", () => {
    // Built week: the interval, the long run and the easy run survived; the
    // threshold run and the fartlek were dropped.
    const built = [
      { day: "mon", sessions: [run("interval", 3)] },
      { day: "sat", sessions: [run("long", 8)] },
    ] as unknown as ProgramDay[];
    const pruned = prunedToSurvivors(skel, built);
    const types = pruned.days.flatMap((d) =>
      d.sessions.map((s) => (s.kind === "run" ? s.runType : s.kind)),
    );
    expect(types).toEqual(["interval", "long", "easy"]);
  });

  it("works out the leg length that brings the week to the cap, not below the floor", () => {
    // 12 mi week: two 1 km-leg hybrids (8 legs) = 4.97 mi hard = 41%.
    const d = days(hybrid(4, 1000), hybrid(4, 1000), run("long", 5), run("easy", 2.03));
    expect(currentLegMeters(d)).toBeCloseTo(1000, 0);
    const leg = legMetersForCap(d, 500)!;
    expect(leg).toBeLessThan(1000);
    expect(leg % 50).toBe(0);
    // 8 legs at that length are within the cap of the same 12-mile week.
    expect((8 * leg) / 1609.344 / 12).toBeLessThanOrEqual(HARD_RUNNING_SHARE_CAP + 0.01);
    expect(legMetersForCap(d, 900)).toBe(900);
  });
});

const START = "2026-08-10";

function program(start: number, hours: string, exp: "beginner" | "intermediate" | "advanced") {
  const gen = {
    profile: {
      firstName: "L",
      age: 35,
      bodyWeight: 80,
      weightUnit: "kg",
      runningExp: exp,
      hybridExp: exp,
      liftingExp: exp,
      trainingClass: "non_highly_trained",
      trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
      sex: "male",
      weeklyHours: hours,
      benchmarks: { fiveKTime: "24:00" },
    },
    startMileage: start,
    programType: "goal_event",
    durationWeeks: 16,
    races: [{ raceDate: "2026-11-24", priority: "A" }],
    startDate: START,
  } as unknown as GenerationInput;
  const skeleton = buildSkeleton(toEngineInput(gen, START));
  return { skeleton, ...assembleProgram(skeleton, [], exp, { fiveKTime: "24:00" }) };
}

describe("end to end", () => {
  const fixtures: Array<[number, string, "beginner" | "intermediate" | "advanced"]> = [
    [12, "h0_5", "beginner"],
    [16, "h5_10", "intermediate"],
    [20, "h10_20", "advanced"],
    [20, "h20_30", "advanced"],
  ];

  it("every capped week is at or under 25% — unless its legs are already at the 500 m floor", () => {
    for (const [start, hours, exp] of fixtures) {
      for (const w of program(start, hours, exp).program.weeks) {
        if (!hardCapApplies(w.days)) continue;
        const legs = currentLegMeters(w.days);
        if (legs !== null && legs <= 520) continue;
        expect(
          weekHardShare(w.days),
          `${hours} ${exp} start ${start} wk${w.weekNumber}`,
        ).toBeLessThanOrEqual(HARD_RUNNING_SHARE_CAP + 0.01);
      }
    }
  });

  it("threshold runs go before hybrid legs: a week with shortened legs keeps no threshold or tempo run", () => {
    for (const [start, hours, exp] of fixtures) {
      for (const w of program(start, hours, exp).program.weeks) {
        if (!hardCapApplies(w.days) || weekMileage(w) < 12) continue; // below 12 mi the low-volume budget sets the legs
        const legs = currentLegMeters(w.days);
        if (legs === null || legs >= 990) continue;
        const quality = w.days
          .flatMap((d) => d.sessions)
          .filter((s) => s.kind === "run" && (s.runType === "threshold" || s.runType === "tempo"));
        expect(quality, `${hours} ${exp} start ${start} wk${w.weekNumber}`).toEqual([]);
      }
    }
  });

  it("the week still delivers the mileage it advertises", () => {
    for (const [start, hours, exp] of fixtures) {
      const { skeleton, program: p } = program(start, hours, exp);
      p.weeks.forEach((w, i) => {
        expect(
          weekMileage(w),
          `${hours} ${exp} start ${start} wk${w.weekNumber}`,
        ).toBeGreaterThanOrEqual(skeleton.weeks[i]!.targetMileage - 0.25);
      });
    }
  });
});
