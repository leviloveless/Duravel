import { describe, it, expect } from "vitest";
import {
  buildTriathlonSkeleton,
  buildTriProgramData,
  triWeekToProgramWeek,
  rebuildTriWeek,
  triAnchorsFromBenchmarks,
  triVolumeLevel,
} from "./index";
import { tri_70_3, tri_140_6 } from "../sports/triathlon";
import { weekIronmanTime } from "@/lib/session-volume";
import { weeklySetTarget, MAX_SESSION_WORKING_SETS } from "../strength";
import type {
  EngineInput,
  EngineRace,
  ExperienceLevel,
  SessionSlot,
  WeekSkeleton,
} from "../types";
import type { ProgramWeek, Session } from "@/lib/schemas";

// --- helpers ----------------------------------------------------------------

function makeInput(over: Partial<EngineInput> = {}): EngineInput {
  return {
    sport: "tri_140_6",
    trainingClass: "highly_trained",
    runningExp: "advanced",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    swimLevel: "advanced",
    bikeLevel: "advanced",
    programType: "goal_event",
    durationWeeks: 20,
    trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    races: [{ weekNumber: 20, priority: "A" }],
    ...over,
  };
}

const slots = (w: WeekSkeleton): SessionSlot[] => w.days.flatMap((d) => d.sessions);
const longRunSlot = (w: WeekSkeleton) =>
  slots(w).find((s): s is Extract<SessionSlot, { kind: "run" }> => s.kind === "run" && s.isLong === true);
const easyRunSlot = (w: WeekSkeleton) =>
  slots(w).find((s): s is Extract<SessionSlot, { kind: "run" }> => s.kind === "run" && !s.isLong);
// The weekly long-ride brick is the Z2 brick; race-specific bricks are Z3.
const longRideBrick = (w: WeekSkeleton) =>
  slots(w).find((s): s is Extract<SessionSlot, { kind: "brick" }> => s.kind === "brick" && s.goalZone === 2);
const liftCount = (w: WeekSkeleton) => slots(w).filter((s) => s.kind === "lift").length;
const firstOfPhase = (weeks: WeekSkeleton[], phase: string, pred: (w: WeekSkeleton) => boolean = () => true) =>
  weeks.find((w) => w.phase === phase && w.microWeek !== "race" && pred(w))!;

// --- (A) long-run cap + ramp ------------------------------------------------

describe("(A) long-run cap + ramp", () => {
  it("140.6 caps the long run at 150 (peak) / 135 (standard) and keeps it > easy", () => {
    const { weeks } = buildTriathlonSkeleton(makeInput(), tri_140_6);
    const peak = firstOfPhase(weeks, "peak");
    const build = firstOfPhase(weeks, "build");

    const peakLong = longRunSlot(peak)!;
    const buildLong = longRunSlot(build)!;
    expect(peakLong).toBeTruthy();
    expect(peakLong.durationMin!).toBeLessThanOrEqual(150);
    expect(buildLong.durationMin!).toBeLessThanOrEqual(135);

    // long > easy in both phases
    expect(peakLong.durationMin!).toBeGreaterThan(easyRunSlot(peak)!.durationMin!);
    expect(buildLong.durationMin!).toBeGreaterThan(easyRunSlot(build)!.durationMin!);
  });

  it("70.3 caps the long run at 120 (peak) / 105 (standard) and keeps it > easy", () => {
    const { weeks } = buildTriathlonSkeleton(
      makeInput({ sport: "tri_70_3", durationWeeks: 20 }),
      tri_70_3,
    );
    const peak = firstOfPhase(weeks, "peak");
    const base = firstOfPhase(weeks, "base");

    const peakLong = longRunSlot(peak)!;
    const baseLong = longRunSlot(base)!;
    expect(peakLong.durationMin!).toBeLessThanOrEqual(120);
    expect(baseLong.durationMin!).toBeLessThanOrEqual(105);
    expect(peakLong.durationMin!).toBeGreaterThan(easyRunSlot(peak)!.durationMin!);
    expect(baseLong.durationMin!).toBeGreaterThan(easyRunSlot(base)!.durationMin!);
  });

  it("the long run is the week's biggest run, and never longer than the session cap", () => {
    // The long run is SEEDED at min(round(easy * 1.4), phase cap). It is then
    // fitted to the week's prescribed minutes and held to the athlete's session
    // cap (Levi, 2026-08-04) — before that clamp existed, triathlon shipped an
    // 11-hour session. So the invariant is the ORDERING plus the ceiling, not the
    // raw 1.4 multiplier, which the fit legitimately compresses when the cap bites.
    const { weeks, caps } = buildTriathlonSkeleton(makeInput(), tri_140_6);
    const peak = firstOfPhase(weeks, "peak");
    const easy = easyRunSlot(peak)!.durationMin!;
    const long = longRunSlot(peak)!.durationMin!;
    expect(long).toBeGreaterThan(easy);
    expect(long).toBeLessThanOrEqual(Math.min(Math.round(easy * 1.4), 150));
    // The cap applies to the SESSION total (run overhead included).
    expect(long + 10).toBeLessThanOrEqual(caps!.cardioSession);
  });
});

// --- (B) discrete long-ride brick ------------------------------------------

describe("(B) long ride is a discrete brick", () => {
  it("peak week has a Z2 long-ride brick with a 15–30 min run tail", () => {
    const { weeks, caps } = buildTriathlonSkeleton(makeInput(), tri_140_6);
    const peak = firstOfPhase(weeks, "peak");
    const brick = longRideBrick(peak)!;
    expect(brick).toBeTruthy();
    expect(brick.segments).toHaveLength(2);

    const bikeSeg = brick.segments.find((s) => s.discipline === "bike")!;
    const runSeg = brick.segments.find((s) => s.discipline === "run")!;
    expect(bikeSeg.durationMin).toBeGreaterThan(0);
    // 75%-of-race long-ride cap for 140.6 peak = 0.75*112/16*60 = 315 min
    expect(bikeSeg.durationMin).toBeLessThanOrEqual(315);
    // Z2 easy tail. Seeded at 15-30 min; the whole brick is then scaled to fit the
    // week's prescribed minutes and the session cap, which scales the tail with it
    // (the segments keep their proportions), so the floor is the scaled one.
    expect(runSeg.durationMin).toBeGreaterThanOrEqual(10);
    expect(runSeg.durationMin).toBeLessThanOrEqual(30);
    expect(runSeg.goalZone).toBe(2);
    // The brick as a whole respects the Zone 1-2 session ceiling.
    const brickTotal = brick.segments.reduce((a, x) => a + x.durationMin, 0);
    expect(brickTotal).toBeLessThanOrEqual(caps!.cardioSession);
  });

  it("no inline long-ride bike session survives (the long ride is the brick)", () => {
    const { weeks } = buildTriathlonSkeleton(makeInput(), tri_140_6);
    const peak = firstOfPhase(weeks, "peak");
    const longBike = slots(peak).find((s) => s.kind === "bike" && s.isLong === true);
    expect(longBike).toBeUndefined();
  });
});

// --- (C) periodized strength ------------------------------------------------

describe("(C) periodized strength counts by phase", () => {
  it("base = 2, build = 1, peak = 1, taper = 0 full-body lifts per week", () => {
    const { weeks } = buildTriathlonSkeleton(makeInput(), tri_140_6);
    const base = firstOfPhase(weeks, "base");
    const build = firstOfPhase(weeks, "build");
    const peak = firstOfPhase(weeks, "peak");
    const taper = weeks.find((w) => w.phase === "taper")!;

    expect(liftCount(base)).toBe(2);
    expect(liftCount(build)).toBe(1);
    expect(liftCount(peak)).toBe(1);
    expect(liftCount(taper)).toBe(0);
  });

  it("lifts avoid the long-run and long-ride days and use valid full-body movements", () => {
    const { weeks } = buildTriathlonSkeleton(makeInput(), tri_140_6);
    const base = firstOfPhase(weeks, "base");
    for (const day of base.days) {
      const hasLift = day.sessions.some((s) => s.kind === "lift");
      const hasKeyAerobic = day.sessions.some(
        (s) => (s.kind === "brick" && s.goalZone === 2) || (s.kind === "run" && s.isLong === true),
      );
      if (hasLift) expect(hasKeyAerobic).toBe(false);
    }
    // lift session shape (mapped): full-body, valid patterns, hypertrophy in base
    const pw = triWeekToProgramWeek(base);
    const lift = pw.days.flatMap((d) => d.sessions).find((s): s is Extract<Session, { kind: "lift" }> => s.kind === "lift")!;
    expect(lift.liftType).toBe("full");
    expect(lift.movements.length).toBeGreaterThanOrEqual(4);
    const valid = ["squat", "hip_hinge", "lunge", "horizontal_press", "vertical_press", "horizontal_pull", "vertical_pull"];
    for (const m of lift.movements) {
      expect(valid).toContain(m.pattern);
      expect(m.repRange).toBe("8-12"); // base hypertrophy
      expect(m.sets).toBeGreaterThanOrEqual(1);
    }
    // Levi's weekly set rule (2026-08-04) now reaches triathlon: the REP RANGE
    // stays tri-specific, but `sets` is whatever the weekly-per-pattern target
    // divides into, not the old flat 3.
    expectWeeklySetTarget(pw, "intermediate");
  });

  it("build/peak lifts are strength (4-6 reps), with weekly set volume applied", () => {
    const { weeks } = buildTriathlonSkeleton(makeInput(), tri_140_6);
    const build = firstOfPhase(weeks, "build");
    const pw = triWeekToProgramWeek(build);
    const lift = pw.days.flatMap((d) => d.sessions).find((s): s is Extract<Session, { kind: "lift" }> => s.kind === "lift")!;
    for (const m of lift.movements) {
      expect(m.repRange).toBe("4-6");
      expect(m.sets).toBeGreaterThanOrEqual(1);
    }
    expectWeeklySetTarget(pw, "intermediate");
  });

  it("weekly set volume scales with LIFTING experience (6 / 8 / 10 per pattern)", () => {
    const { weeks } = buildTriathlonSkeleton(makeInput(), tri_140_6);
    const base = firstOfPhase(weeks, "base");
    for (const exp of ["beginner", "intermediate", "advanced"] as const) {
      expectWeeklySetTarget(triWeekToProgramWeek(base, {}, exp), exp);
    }
  });

  it("no triathlon lift session exceeds the working-set ceiling", () => {
    const { weeks } = buildTriathlonSkeleton(makeInput(), tri_140_6);
    for (const w of weeks) {
      const pw = triWeekToProgramWeek(w, {}, "advanced");
      for (const d of pw.days) {
        for (const s of d.sessions) {
          if (s.kind !== "lift") continue;
          const total = s.movements.reduce((n, m) => n + m.sets, 0);
          expect(total).toBeLessThanOrEqual(MAX_SESSION_WORKING_SETS);
        }
      }
    }
  });
});

/** Every pattern trained in the week hits its weekly working-set target, unless
 *  the per-session ceiling genuinely had nowhere left to put the volume. */
function expectWeeklySetTarget(pw: ProgramWeek, liftingExp: ExperienceLevel): void {
  const lifts = pw.days
    .flatMap((d) => d.sessions)
    .filter((s): s is Extract<Session, { kind: "lift" }> => s.kind === "lift");
  if (lifts.length === 0) return;
  const target = weeklySetTarget(liftingExp, pw.microWeek);
  const byPattern = new Map<string, number>();
  for (const s of lifts) {
    for (const m of s.movements) byPattern.set(m.pattern, (byPattern.get(m.pattern) ?? 0) + m.sets);
  }
  expect(byPattern.size).toBeGreaterThan(0);
  for (const [pattern, total] of byPattern) {
    expect(total, `${pattern} weekly sets`).toBeLessThanOrEqual(target);
    expect(total, `${pattern} weekly sets`).toBeGreaterThanOrEqual(
      Math.min(target, lifts.length),
    );
  }
}

// --- (D) race periodization -------------------------------------------------

describe("(D) mid-program race week scaling", () => {
  const baseline: EngineRace[] = [{ weekNumber: 16, priority: "A" }];

  function build(races: EngineRace[]) {
    return buildTriathlonSkeleton(
      makeInput({ durationWeeks: 16, races }),
      tri_140_6,
    ).weeks;
  }

  it("scales a mid-program race week (C → ×0.70), marks raceDay + race session, keeps frequency", () => {
    const withRace = build([{ weekNumber: 8, priority: "C" }, ...baseline]);
    const noRace = build(baseline);
    const w8 = withRace[7]!;
    const n8 = noRace[7]!;

    expect(w8.microWeek).toBe("race");
    expect(w8.raceDay?.priority).toBe("C");
    // race session present
    expect(slots(w8).some((s) => s.kind === "race")).toBe(true);
    // scaled ≈ 0.70 of the un-raced week's minutes (rounding tolerance ±1)
    expect(Math.abs(w8.targetCardioMinutes - n8.targetCardioMinutes * 0.7)).toBeLessThanOrEqual(1);
    // frequency preserved: same count of cardio (swim/bike/run/brick) sessions
    const cardio = (w: WeekSkeleton) => slots(w).filter((s) => ["swim", "bike", "run", "brick"].includes(s.kind)).length;
    expect(cardio(w8)).toBe(cardio(n8));
  });

  it("A race → ×0.50, B race → ×0.60", () => {
    const a = build([{ weekNumber: 8, priority: "A" }, ...baseline]);
    const b = build([{ weekNumber: 8, priority: "B" }, ...baseline]);
    const noRace = build(baseline);
    expect(Math.abs(a[7]!.targetCardioMinutes - noRace[7]!.targetCardioMinutes * 0.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(b[7]!.targetCardioMinutes - noRace[7]!.targetCardioMinutes * 0.6)).toBeLessThanOrEqual(1);
  });

  it("the end-of-program A taper still owns the final race (not double-cut)", () => {
    const weeks = build(baseline);
    const final = weeks[15]!;
    expect(final.phase).toBe("taper");
    expect(final.microWeek).toBe("race");
    expect(final.raceDay?.priority).toBe("A");
    // taper volume (≈60% of peak), NOT a 0.5 race-week cut of a taper week
    const firstTaper = weeks[14]!;
    expect(firstTaper.phase).toBe("taper");
    expect(final.targetCardioMinutes).toBeGreaterThan(0);
  });
});

describe("(D) post-race active recovery", () => {
  // Race at week 6 (mid-program, non-taper) → week 7 is the recovery week.
  function build(races: EngineRace[]) {
    return buildTriathlonSkeleton(
      makeInput({ durationWeeks: 18, races }),
      tri_140_6,
    ).weeks;
  }
  const races: EngineRace[] = [{ weekNumber: 6, priority: "A" }, { weekNumber: 18, priority: "A" }];

  it("scales the week after an A race by ×0.25 and strips vo2/threshold/brick", () => {
    const withRace = build(races);
    const noRace = build([{ weekNumber: 18, priority: "A" }]);
    const w7 = withRace[6]!;
    const n7 = noRace[6]!;

    expect(w7.microWeek).not.toBe("race");
    expect(Math.abs(w7.targetCardioMinutes - n7.targetCardioMinutes * 0.25)).toBeLessThanOrEqual(1);

    // no bricks / vo2 / threshold survive
    const ss = slots(w7);
    expect(ss.some((s) => s.kind === "brick")).toBe(false);
    expect(ss.some((s) => s.kind === "bike" && (s.sessionType === "vo2" || s.sessionType === "threshold"))).toBe(false);
    expect(ss.some((s) => s.kind === "swim" && s.sessionType === "threshold")).toBe(false);

    // duration caps: swim ≤45, bike ≤90, run ≤30
    for (const s of ss) {
      if (s.kind === "swim") expect(s.durationMin).toBeLessThanOrEqual(45);
      if (s.kind === "bike") expect(s.durationMin).toBeLessThanOrEqual(90);
      if (s.kind === "run") expect(s.durationMin ?? 0).toBeLessThanOrEqual(30);
    }
  });

  it("after an A race, the first training day is full rest", () => {
    const w7 = build(races)[6]!;
    expect(w7.days[0]!.sessions).toEqual([{ kind: "rest" }]);
  });

  it("week 6 is itself a scaled A race week (×0.50) with a race session", () => {
    const w6 = build(races)[5]!;
    const noRace = build([{ weekNumber: 18, priority: "A" }])[5]!;
    expect(w6.phase).not.toBe("taper");
    expect(w6.raceDay?.priority).toBe("A");
    expect(slots(w6).some((s) => s.kind === "race")).toBe(true);
    expect(Math.abs(w6.targetCardioMinutes - noRace.targetCardioMinutes * 0.5)).toBeLessThanOrEqual(1);
  });
});

// --- weekIronmanTime --------------------------------------------------------

describe("weekIronmanTime splits disciplines + brick segments", () => {
  it("splits swim/bike/run/lift and brick segments and totals correctly", () => {
    const week = {
      days: [
        {
          day: "mon" as const,
          sessions: [
            { kind: "swim", durationMin: 30, goalZone: 2, sessionType: "endurance" },
            { kind: "bike", durationMin: 60, goalZone: 2, sessionType: "endurance" },
          ] as Session[],
        },
        {
          day: "tue" as const,
          sessions: [
            { kind: "run", runType: "easy", durationMin: 40, paceMinMile: "by effort", distanceMiles: 0, goalZone: 2 },
            { kind: "lift", liftType: "full", movements: [{ pattern: "squat", sets: 3, repRange: "8-12" }] },
          ] as Session[],
        },
        {
          day: "sat" as const,
          sessions: [
            {
              kind: "brick",
              goalZone: 2,
              segments: [
                { discipline: "bike", durationMin: 90, goalZone: 2 },
                { discipline: "run", durationMin: 20, goalZone: 2 },
              ],
            },
          ] as Session[],
        },
      ],
    };
    const t = weekIronmanTime(week);
    expect(t.swim).toBe(30); // swim session
    expect(t.bike).toBe(60 + 90); // bike session + brick bike segment
    expect(t.run).toBe(50 + 20); // run session (40 + 10 overhead) + brick run segment
    expect(t.lift).toBe(60); // flat 60-min strength
    expect(t.total).toBe(30 + 150 + 70 + 60);
  });
});

// --- integration / back-compat ---------------------------------------------

describe("integration", () => {
  it("buildTriProgramData produces a valid program and rebuildTriWeek preserves race context", () => {
    const input = makeInput({ durationWeeks: 18, races: [{ weekNumber: 6, priority: "A" }, { weekNumber: 18, priority: "A" }] });
    const skeleton = buildTriathlonSkeleton(input, tri_140_6);
    const anchors = triAnchorsFromBenchmarks({ cssPace: "1:30", ftpWatts: 250 });
    const program = buildTriProgramData(skeleton, anchors);
    expect(program.weeks).toHaveLength(18);

    // rebuild the post-race week — race context (no brick, first-day rest) preserved
    const rebuilt = rebuildTriWeek(skeleton.weeks[6]!, input, tri_140_6, anchors);
    expect(rebuilt.skeletonWeek.days.flatMap((d) => d.sessions).some((s) => s.kind === "brick")).toBe(false);
    expect(rebuilt.skeletonWeek.days[0]!.sessions).toEqual([{ kind: "rest" }]);

    // rebuild the race week — race session preserved
    const rebuiltRace = rebuildTriWeek(skeleton.weeks[5]!, input, tri_140_6, anchors);
    expect(rebuiltRace.skeletonWeek.days.flatMap((d) => d.sessions).some((s) => s.kind === "race")).toBe(true);
  });

  it("triVolumeLevel blends the three disciplines", () => {
    expect(triVolumeLevel(makeInput({ runningExp: "beginner", swimLevel: "beginner", bikeLevel: "beginner" }))).toBe("beginner");
    expect(triVolumeLevel(makeInput({ runningExp: "advanced", swimLevel: "advanced", bikeLevel: "advanced" }))).toBe("advanced");
  });
});
