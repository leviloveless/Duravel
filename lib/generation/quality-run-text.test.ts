/**
 * REGRESSION — the interval/threshold prescription text must describe the same
 * workout the stored distance describes (Levi, 2026-08-04).
 *
 * The bug: `INTERVAL_REPS` / `THRESHOLD_REPS` are fixed per experience level,
 * while `reconcile.ts` resizes every run's `distanceMiles` to make the week hit
 * its mileage target. Nothing reconciled the two, so a run stored at 1.8 miles of
 * work still told the athlete to run "3 x 1 mile". Across 87 audited runs, 100%
 * mismatched — the worst by 3.7 miles.
 */
import { describe, it, expect } from "vitest";
import type { GenerationInput } from "@/lib/schemas";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { assembleProgram } from "./assemble";
import { sessionMiles } from "@/lib/session-volume";
import {
  repsForWorkMiles,
  snapWorkMiles,
  REP_DISTANCE_MILES,
  recoveryMinutesForReps,
} from "@/lib/engine/interval-structure";

const KM = 0.621371;
const START = "2026-08-10";

function input(runningExp: "beginner" | "intermediate" | "advanced", days: string[]) {
  return {
    profile: {
      firstName: "L",
      age: 35,
      bodyWeight: 80,
      weightUnit: "kg",
      runningExp,
      hybridExp: "intermediate",
      liftingExp: "intermediate",
      trainingClass: "non_highly_trained",
      trainingDays: days,
      sex: "male",
      benchmarks: { fiveKTime: "22:00", tenKTime: "46:00", ski2kTime: "7:30", row2kTime: "7:20" },
    },
    programType: "goal_event",
    durationWeeks: 16,
    races: [{ raceDate: "2026-11-24", priority: "A" }],
    startDate: START,
  } as unknown as GenerationInput;
}

describe("rep count follows the run's actual work distance", () => {
  it("derives reps from distance, not from the experience table", () => {
    // 3.1 mi of threshold work is 3 one-mile reps, whatever the athlete's level.
    expect(repsForWorkMiles("threshold", 3.1, "beginner")).toBe(3);
    expect(repsForWorkMiles("threshold", 3.1, "advanced")).toBe(3);
    // Interval reps are 1 km.
    expect(repsForWorkMiles("interval", 5 * KM, "beginner")).toBe(5);
    expect(repsForWorkMiles("interval", 3.1, "intermediate")).toBe(5);
    // Non-rep run types have no rep count at all.
    expect(repsForWorkMiles("easy", 6, "intermediate")).toBeNull();
    expect(repsForWorkMiles("long", 12, "intermediate")).toBeNull();
  });

  it("falls back to the experience default only when there is no distance yet", () => {
    expect(repsForWorkMiles("threshold", 0, "intermediate")).toBe(3);
    expect(repsForWorkMiles("interval", 0, "advanced")).toBe(6);
  });

  it("snaps work distance onto a whole rep boundary", () => {
    expect(snapWorkMiles("threshold", 1.8, "intermediate")).toBe(2);
    expect(snapWorkMiles("threshold", 3.3, "intermediate")).toBe(3);
    expect(snapWorkMiles("interval", 2.9, "intermediate")).toBe(3.1); // 5 x 1 km
    expect(snapWorkMiles("easy", 4.7, "intermediate")).toBe(4.7); // untouched
  });

  it("scales between-rep recovery to the real rep count", () => {
    // N reps have N-1 gaps, so more reps means a higher fraction of work time.
    expect(recoveryMinutesForReps("interval", 2, 20)).toBe(10); // 1/2 x 1:1
    expect(recoveryMinutesForReps("interval", 5, 20)).toBe(16); // 4/5 x 1:1
    expect(recoveryMinutesForReps("threshold", 3, 30)).toBe(10); // 2/3 x 0.5
    expect(recoveryMinutesForReps("interval", 1, 20)).toBe(0); // one rep, no gap
  });
});

describe("generated programs: text, headline and weekly total agree", () => {
  const CASES: [Parameters<typeof input>[0], string[]][] = [
    ["beginner", ["mon", "wed", "fri"]],
    ["intermediate", ["mon", "tue", "thu", "sat"]],
    ["intermediate", ["mon", "tue", "wed", "thu", "fri", "sat"]],
    ["advanced", ["mon", "tue", "wed", "thu", "fri"]],
  ];

  it("every interval/threshold run's text prescribes the distance it is stored at", () => {
    let checked = 0;
    for (const [exp, days] of CASES) {
      const gen = input(exp, days);
      const skeleton = buildSkeleton(toEngineInput(gen, START));
      const { program } = assembleProgram(skeleton, [], exp, {
        fiveKTime: "22:00",
        tenKTime: "46:00",
      });
      for (const w of program.weeks) {
        for (const d of w.days) {
          for (const s of d.sessions) {
            if (s.kind !== "run") continue;
            if (s.runType !== "interval" && s.runType !== "threshold") continue;
            if (!(s.distanceMiles > 0)) continue; // unfilled placeholder (race week)
            const m = /(\d+) x 1 ?(km|mile)/.exec(s.description ?? "");
            expect(m, `no rep text in week ${w.weekNumber} ${d.day}`).toBeTruthy();
            const repMiles = REP_DISTANCE_MILES[s.runType]!;
            const describedWork = Number(m![1]) * repMiles;
            // Within a tenth — the stored value is rounded to one decimal.
            expect(
              Math.abs(describedWork - s.distanceMiles),
              `week ${w.weekNumber} ${d.day} ${s.runType}: text "${m![0]}" = ${describedWork.toFixed(2)} mi vs stored ${s.distanceMiles} mi`,
            ).toBeLessThanOrEqual(0.1);
            // And the headline is always the larger, total-on-feet figure.
            expect(sessionMiles(s)).toBeGreaterThan(s.distanceMiles);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10); // the sweep actually found quality runs
  });

  it("race weeks count their warmup/cooldown instead of reporting work miles only", () => {
    const gen = input("intermediate", ["mon", "tue", "wed", "thu", "fri", "sat"]);
    const skeleton = buildSkeleton(toEngineInput(gen, START));
    const { program } = assembleProgram(skeleton, [], "intermediate", {
      fiveKTime: "22:00",
      tenKTime: "46:00",
    });
    const raceWeek = program.weeks.find((w) => w.microWeek === "race");
    expect(raceWeek).toBeTruthy();
    const runs = raceWeek!.days.flatMap((d) => d.sessions).filter((s) => s.kind === "run");
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      if (r.kind !== "run") continue;
      expect(r.overheadMiles).toBeGreaterThan(0);
    }
  });
});

describe("race-week placeholders are real sessions", () => {
  it("never ships a run with zero distance or an empty pace", () => {
    // A/B race weeks skip resizing, so a session the AI omitted used to survive as
    // its placeholder — "Easy run — 0 min @ /mile — 0 miles" on the athlete's
    // calendar in the most important week of the program.
    for (const [exp, days] of [
      ["beginner", ["mon", "wed", "fri"]],
      ["intermediate", ["mon", "tue", "wed", "thu", "fri", "sat"]],
      ["advanced", ["mon", "tue", "wed", "thu", "fri"]],
    ] as const) {
      const gen = input(exp, [...days]);
      const skeleton = buildSkeleton(toEngineInput(gen, START));
      const { program } = assembleProgram(skeleton, [], exp, {
        fiveKTime: "22:00",
        tenKTime: "46:00",
      });
      for (const w of program.weeks) {
        for (const d of w.days) {
          for (const s of d.sessions) {
            if (s.kind !== "run") continue;
            expect(s.distanceMiles, `wk${w.weekNumber} ${d.day} ${s.runType}`).toBeGreaterThan(0);
            expect(s.paceMinMile, `wk${w.weekNumber} ${d.day} ${s.runType}`).not.toBe("");
            expect(s.durationMin).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
