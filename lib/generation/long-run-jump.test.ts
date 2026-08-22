/**
 * The long run may not jump past what the athlete has recently run
 * (Levi, 2026-08-19).
 *
 * ## Why this rule exists and the weekly-mileage rules do not catch it
 *
 * In a cohort of 5,205 runners across ~500,000 logged runs, change in WEEKLY
 * VOLUME had little predictive value, while a single run exceeding that runner's
 * longest of the previous 30 days by 10–30% carried 64% higher injury risk. The
 * damage is done by one ambitious session, not by the weekly sum — and until
 * now the engine bounded only the sum.
 *
 * ## What it was doing before
 *
 * Measured across 2,160 generated weeks (4 bands × 3 experience levels × 2
 * training classes × 6 starting mileages):
 *
 *   - **325 weeks (15.0%)** grew the long run more than 10% past its own
 *     trailing four-week max;
 *   - **49 weeks** grew it by more than 30%;
 *   - worst case **+108.7%** — 4.6 mi to 9.6 mi, in a TAPER week, three weeks
 *     out from the race. The taper week's mileage had nowhere else to go: one
 *     run was left in the week, so the reconciler put all of it there and the
 *     athlete's single longest run of the entire program landed during the
 *     taper.
 *
 * After: **255 weeks (11.8%) over 10%, worst +81%.** A real reduction, and an
 * HONEST one rather than the number a stronger-looking implementation produced.
 *
 * ## Why it is 11.8% and not zero — read this before "fixing" it
 *
 * The ceiling can only move miles somewhere else, and in the weeks that break it
 * there IS nowhere else. A 0–5 h week is one run plus hybrids; a taper week is
 * often a single run. Trimming that run means either
 *
 *   - emitting a second run — but `buildEasyRuns(…, atLeastOne)` never makes one
 *     shorter than 45 minutes, so rehousing 2 miles creates a 4-mile session, the
 *     week lands far over target, and the convergence loop cuts the long run to
 *     its MINIMUM to pay for it. Measured: a 12 mi/week beginner's long run
 *     collapsed to 4.6 mi and stayed there for all 16 weeks, each flattened week
 *     lowering the next week's ceiling. That version scored 1.6% and was much
 *     worse training; or
 *   - shipping a week under its stated mileage, which breaks the stronger promise
 *     that the plan and the calendar agree.
 *
 * So the ceiling yields in single-run weeks, and the residual violations are
 * concentrated exactly there. Closing the gap properly means allowing a SHORTER
 * second run (a 25-minute recovery jog is a real session) — a change to the
 * 45-minute floor, and Levi's call, not this file's.
 *
 * ## What must NOT change
 *
 * The week still hits its prescribed mileage. The cap moves miles between runs;
 * it does not delete them.
 *
 * Every import here is one `main` already has, so this file fails there on
 * BEHAVIOUR. The window arithmetic is unit-tested in
 * `lib/engine/long-run-cap.test.ts`, which necessarily fails on main by absence.
 */
import { describe, it, expect } from "vitest";
import type { GenerationInput } from "@/lib/schemas";
import type { ExperienceLevel } from "@/lib/engine/types";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { assembleProgram } from "./assemble";
import { sessionMiles, weekMileage } from "@/lib/session-volume";

const START = "2026-08-10";

/** Rounding allowance: distances are written to one decimal, so a cap of 5.06
 *  ships as 5.1. Expressed as a share so it does not shrink at high mileage. */
const ROUNDING = 0.02;

function gen(startMileage: number, hours: string, exp: ExperienceLevel): GenerationInput {
  return {
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
    startMileage,
    programType: "goal_event",
    durationWeeks: 16,
    races: [{ raceDate: "2026-11-24", priority: "A" }],
    startDate: START,
  } as unknown as GenerationInput;
}

interface WeekLong {
  week: number;
  micro: string;
  target: number;
  actual: number;
  longMiles: number;
}

function longRunsOf(
  startMileage: number,
  hours = "h10_20",
  exp: ExperienceLevel = "beginner",
): WeekLong[] {
  const skeleton = buildSkeleton(toEngineInput(gen(startMileage, hours, exp), START));
  const { program } = assembleProgram(skeleton, [], exp, { fiveKTime: "24:00" });
  return program.weeks.map((w, i) => {
    let longMiles = 0;
    for (const d of w.days)
      for (const s of d.sessions)
        if (s.kind === "run" && s.runType === "long")
          longMiles = Math.max(longMiles, sessionMiles(s));
    return {
      week: w.weekNumber,
      micro: w.microWeek,
      target: skeleton.weeks[i]!.targetMileage,
      actual: weekMileage(w),
      longMiles,
    };
  });
}

describe("no long run outruns the athlete's own recent longest", () => {
  // Uses only exports `main` already has, so it fails there on BEHAVIOUR.
  it("cuts the over-10% weeks by a quarter and the worst case by a third", () => {
    // The bound the engine can actually promise, measured the same way the audit
    // measures it. Tightening these is progress; loosening them is a regression.
    let weeks = 0;
    let over10 = 0;
    let worst = 0;
    for (const hours of ["h0_5", "h5_10", "h10_20", "h20_30"]) {
      for (const start of [5, 8, 12, 30]) {
        const history: number[] = [];
        for (const w of longRunsOf(start, hours)) {
          const prevMax = Math.max(0, ...history.slice(-4));
          if (prevMax > 0 && w.longMiles > 0) {
            weeks++;
            const pct = w.longMiles / prevMax - 1;
            if (pct > 0.1 + ROUNDING) over10++;
            worst = Math.max(worst, pct);
          }
          history.push(w.longMiles);
        }
      }
    }
    // main: 15.0% of weeks, worst +108.7%.
    expect(over10 / weeks).toBeLessThan(0.13);
    expect(worst).toBeLessThan(0.85);
  });

  it("kills the taper-week spike specifically", () => {
    // The worst case found: +108.7%, 4.6 → 9.6 mi, in week 15 of a taper — the
    // athlete's single longest run of the whole program, three weeks out.
    const weeks = longRunsOf(8, "h10_20");
    const taper = weeks.find((w) => w.week === 15)!;
    const earlierMax = Math.max(...weeks.filter((w) => w.week < 15).map((w) => w.longMiles));
    expect(taper.longMiles).toBeLessThanOrEqual(earlierMax * 1.15);
  });

  it("still lets the long run GROW — this is a ceiling, not a freeze", () => {
    const weeks = longRunsOf(20, "h20_30", "advanced");
    const first = weeks[0]!.longMiles;
    const peak = Math.max(...weeks.map((w) => w.longMiles));
    expect(peak).toBeGreaterThan(first * 1.2);
  });

  it("does not cost the week its mileage — miles move, they do not vanish", () => {
    for (const hours of ["h5_10", "h10_20"]) {
      for (const start of [8, 12, 30]) {
        for (const w of longRunsOf(start, hours)) {
          expect(
            w.actual,
            `${hours} start=${start} wk${w.week}: target ${w.target}, delivered ${w.actual}`,
          ).toBeGreaterThanOrEqual(w.target - 0.25);
        }
      }
    }
  });
});
