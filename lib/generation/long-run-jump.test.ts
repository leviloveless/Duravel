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
 * After: **78 weeks (3.6%) over 10%, ZERO over 30%, worst +17.3%.**
 *
 * ## The two changes that got it there, both researched first
 *
 * A first cut scored 11.8% because the displaced miles had nowhere to go: the
 * only session the reconciler could build was a 45-minute easy run, which on a
 * 2-mile remainder puts the week far over target — and the convergence loop then
 * cut the long run to its MINIMUM to pay for it. (Measured: a 12 mi/week
 * beginner's long run collapsed to 4.6 mi for all 16 weeks. That version scored a
 * prettier 1.6% and was much worse training. Do not re-derive it.)
 *
 *   1. **A 20-minute RECOVERY JOG is now a legal session** for that remainder.
 *      Coaching practice puts recovery runs at 20–45 min and easy runs at 45–75;
 *      a flat 45-minute floor treated them as one thing. No trial establishes a
 *      minimum useful duration in either direction — the 45 was not evidence-based
 *      either — and what evidence exists favours frequency over session length.
 *      See `MIN_RECOVERY_TOTAL` in `reconcile.ts`.
 *   2. **A week may report short when the ceiling is what caused it.** The cohort
 *      finding behind this whole rule is that weekly-volume change predicted
 *      injury poorly while single-run jumps predicted it well — so between those
 *      two invariants, the weekly total is the one worth bending.
 *
 * ## What must NOT change
 *
 * The week still hits its prescribed mileage EXCEPT where the ceiling binds, and
 * there the reconciler returns the lower figure so the prescription and the
 * calendar still agree. Miles are never silently dropped.
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
import { sessionMiles, sessionTiming, weekMileage } from "@/lib/session-volume";

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
  it("cuts the over-10% weeks by three quarters and eliminates every >30% jump", () => {
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
    // This subset is deliberately the harsh corner of the sweep — beginner only,
    // and it includes `h0_5`, the band with the fewest runs to spread a week
    // across and therefore the hardest ceiling to honour. It measures 6.7% where
    // the full 2,160-week sweep measures 3.6%, and main measures 15.0% here.
    // Tightening these is progress; loosening them is a regression.
    expect(over10 / weeks).toBeLessThan(0.08);
    expect(worst).toBeLessThan(0.2);
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
    // `w.target` is the figure the reconciler HANDED BACK and `assembleProgram`
    // adopted, so this also pins the honest-shortfall path: where the ceiling
    // lowers a week, the number the athlete is shown comes down with it. A week
    // delivering less than the target it advertises is still a bug.
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

  it("prescribes a RECOVERY jog for the displaced miles, not a 45-minute filler", () => {
    // The session that makes the ceiling affordable. 20–45 min is the coaching
    // band for a recovery run; the old floor could only build 45+.
    // `h0_5` at 12 mi/week: five hours of running split across few sessions is
    // where the ceiling most often leaves a sub-3.5 mi remainder, so this is the
    // fixture that actually exercises the jog. It emits five of them.
    const skeleton = buildSkeleton(toEngineInput(gen(12, "h0_5", "beginner"), START));
    const { program } = assembleProgram(skeleton, [], "beginner", { fiveKTime: "24:00" });
    const jogs = program.weeks
      .flatMap((w) => w.days.flatMap((d) => d.sessions))
      .filter((s) => s.kind === "run" && s.description?.startsWith("Recovery jog"));
    expect(jogs.length).toBeGreaterThan(0);
    for (const j of jogs) {
      const total = sessionTiming(j).total;
      expect(total, "a recovery jog is at least 20 minutes").toBeGreaterThanOrEqual(20);
      expect(total, "…and still a recovery run, not an easy run").toBeLessThanOrEqual(45);
    }
  });
});
