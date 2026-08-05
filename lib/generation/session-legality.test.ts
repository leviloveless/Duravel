/**
 * REGRESSION — two sessions a day is absolute, and no session exceeds its cap
 * (Levi, 2026-08-04).
 *
 * The engine used to resolve "this week's volume doesn't fit" by piling whatever
 * it could not place onto one Zone 1-2 block, unbounded. A real generated week for
 * a 30-40 h athlete shipped a SINGLE 1707-minute (28-hour) cardio session and
 * reported the week's total as met. A 3-day athlete's Monday carried five
 * sessions and 6.4 hours.
 *
 * The rules now: at most 2 sessions a day; runs/lifts/hybrids bounded by
 * `caps.session`; Zone 1-2 blocks bounded by the higher `caps.cardioSession`
 * (a long easy ride is the one session type whose length is limited by time
 * rather than recovery cost). A week that still cannot hold its prescription
 * lands SHORT — honestly — rather than shipping a session nobody can do.
 */
import { describe, it, expect } from "vitest";
import type { GenerationInput, WeeklyHoursBand } from "@/lib/schemas";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { assembleProgram } from "./assemble";
import { sessionTiming } from "@/lib/session-volume";
import {
  bandMinTrainingDays,
  bandMaxWeeklyMinutes,
  bandAllowedForFamily,
  bandsForFamily,
  clampBandToFamily,
} from "@/lib/engine/time-budget";

const START = "2026-08-10";

/** Levi's rule (2026-08-04): 0-5 h needs 4 days, 5-10 h needs 5, 10+ h needs 7. */
const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const REQUIRED_DAYS = (band: WeeklyHoursBand): string[] => WEEK.slice(0, bandMinTrainingDays(band));

function gen(exp: "beginner" | "intermediate" | "advanced", band: WeeklyHoursBand) {
  return {
    profile: {
      firstName: "L",
      age: 35,
      bodyWeight: 80,
      weightUnit: "kg",
      runningExp: exp,
      hybridExp: exp,
      liftingExp: exp,
      trainingClass: "highly_trained",
      trainingDays: REQUIRED_DAYS(band),
      sex: "male",
      weeklyHours: band,
      benchmarks: { fiveKTime: "22:00", tenKTime: "46:00", ski2kTime: "7:30", row2kTime: "7:20" },
    },
    programType: "goal_event",
    durationWeeks: 16,
    races: [{ raceDate: "2026-11-24", priority: "A" }],
    startDate: START,
  } as unknown as GenerationInput;
}

const BANDS: WeeklyHoursBand[] = ["h0_5", "h5_10", "h10_20", "h20_30", "h30_40"];
const LEVELS = ["beginner", "intermediate", "advanced"] as const;

describe("every generated session is legal, at every weekly-hours band", () => {
  it("never puts a third session on a day, and never exceeds a cap", () => {
    let checked = 0;
    for (const band of BANDS) {
      for (const exp of LEVELS) {
        const input = gen(exp, band);
        const skeleton = buildSkeleton(toEngineInput(input, START));
        const caps = skeleton.caps!;
        const { program } = assembleProgram(skeleton, [], exp, {
          fiveKTime: "22:00",
          tenKTime: "46:00",
        });
        for (const w of program.weeks) {
          for (const d of w.days) {
            expect(
              d.sessions.length,
              `${band}/${exp} wk${w.weekNumber} ${d.day} has ${d.sessions.length} sessions`,
            ).toBeLessThanOrEqual(2);
            for (const s of d.sessions) {
              if (s.kind === "race" || s.kind === "lift") continue;
              const limit = s.kind === "cardio" ? caps.cardioSession : caps.session;
              expect(
                sessionTiming(s).total,
                `${band}/${exp} wk${w.weekNumber} ${d.day} ${s.kind}`,
              ).toBeLessThanOrEqual(limit);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500); // the sweep really covered the programs
  });

  it("a high-volume band gets LONGER Zone 1-2 blocks, not more sessions", () => {
    const longest = (band: WeeklyHoursBand): number => {
      const input = gen("advanced", band);
      const skeleton = buildSkeleton(toEngineInput(input, START));
      const { program } = assembleProgram(skeleton, [], "advanced", {
        fiveKTime: "22:00",
        tenKTime: "46:00",
      });
      let max = 0;
      for (const w of program.weeks) {
        for (const d of w.days) {
          for (const s of d.sessions) {
            if (s.kind !== "cardio") continue;
            max = Math.max(max, sessionTiming(s).total);
          }
        }
      }
      return max;
    };
    // Strictly increasing with the band — that is the whole mechanism.
    expect(longest("h30_40")).toBeGreaterThan(longest("h10_20"));
    expect(longest("h20_30")).toBeGreaterThan(longest("h5_10"));
  });
});

// --- the band's own hours are a hard ceiling ---------------------------------

describe("no week exceeds the time budget the athlete selected", () => {
  it("keeps total weekly training inside the band, lifts included", () => {
    // The progression is driven by experience + training class + week number and
    // never checked itself against the budget: h20_30 peaked at 32 h and h30_40 at
    // 46 h. An athlete who chose "30-40 hours" was handed 46.
    for (const band of BANDS) {
      for (const exp of LEVELS) {
        const skeleton = buildSkeleton(toEngineInput(gen(exp, band), START));
        const { program } = assembleProgram(skeleton, [], exp, {
          fiveKTime: "22:00",
          tenKTime: "46:00",
        });
        for (const w of program.weeks) {
          const total = w.days
            .flatMap((d) => d.sessions)
            .reduce((n, s) => n + sessionTiming(s).total, 0);
          expect(total, `${band}/${exp} wk${w.weekNumber}`).toBeLessThanOrEqual(
            bandMaxWeeklyMinutes(band),
          );
        }
      }
    }
  });

  it("requires more training days as the budget grows", () => {
    expect(bandMinTrainingDays("h0_5")).toBe(4);
    expect(bandMinTrainingDays("h5_10")).toBe(5);
    expect(bandMinTrainingDays("h10_20")).toBe(7);
    expect(bandMinTrainingDays("h20_30")).toBe(7);
    expect(bandMinTrainingDays("h30_40")).toBe(7);
    // Never decreasing — a bigger budget can never need fewer days.
    let prev = 0;
    for (const band of BANDS) {
      const d = bandMinTrainingDays(band);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});

// --- 30-40 hours is not a HYROX/DEKA band -----------------------------------

describe("weekly-hours bands are limited by sport family", () => {
  it("offers 30-40 h to triathlon but not to HYROX or DEKA", () => {
    expect(bandAllowedForFamily("triathlon", "h30_40")).toBe(true);
    expect(bandAllowedForFamily("station_hybrid", "h30_40")).toBe(false);
    // Everything up to 20-30 h stays available everywhere.
    for (const b of ["h0_5", "h5_10", "h10_20", "h20_30"] as WeeklyHoursBand[]) {
      expect(bandAllowedForFamily("station_hybrid", b)).toBe(true);
      expect(bandAllowedForFamily("triathlon", b)).toBe(true);
    }
    expect(bandsForFamily("station_hybrid")).toEqual(["h0_5", "h5_10", "h10_20", "h20_30"]);
    expect(bandsForFamily("triathlon")).toHaveLength(5);
  });

  it("clamps a stored HYROX program that still carries the old band", () => {
    // A program SAVED before this rule would otherwise regenerate a 40-hour
    // station-hybrid week on recalculate. The engine normalizes at its entry.
    expect(clampBandToFamily("station_hybrid", "h30_40")).toBe("h20_30");
    expect(clampBandToFamily("station_hybrid", "h10_20")).toBe("h10_20");
    expect(clampBandToFamily("triathlon", "h30_40")).toBe("h30_40");
  });

  it("a HYROX skeleton built with h30_40 behaves exactly like h20_30", () => {
    const build = (band: WeeklyHoursBand) => {
      const input = gen("advanced", band);
      // gen() derives training days from the band; pin both to 7 so the only
      // difference under test is the band itself.
      (input.profile as { trainingDays: string[] }).trainingDays = [...WEEK];
      return buildSkeleton(toEngineInput(input, START));
    };
    const clamped = build("h30_40");
    const explicit = build("h20_30");
    expect(clamped.weeks.map((w) => w.targetCardioMinutes)).toEqual(
      explicit.weeks.map((w) => w.targetCardioMinutes),
    );
    expect(clamped.caps).toEqual(explicit.caps);
  });
});

// --- two a day is absolute, on EVERY path ------------------------------------
//
// The band work masked this: `BAND_SESSION_CAP` kept banded weeks small enough
// that days rarely doubled past two. Programs with NO weekly-hours band — every
// program saved before that field existed, which still regenerate on Recalculate
// — had no such protection. A 420-week audit of the bandless path found 227 days
// carrying THREE sessions, the worst totalling 6.4 hours.
//
// Three separate places had to change: the day round-robin in `assignDays` wrapped
// with no per-day bound; `capSessionsPerDay` ran mid-pipeline with the full
// protected set (so it had nowhere to relocate) and was undone by later passes;
// and `leastLoadedUnderCap` in the reconciler fell back to a cap-IGNORING helper
// when every day was full.

describe("legacy programs with no weekly-hours band are still legal", () => {
  const LEGACY_DAYS = [3, 4, 5, 6, 7];

  function legacyInput(
    exp: "beginner" | "intermediate" | "advanced",
    days: number,
    cls: "non_highly_trained" | "highly_trained",
  ) {
    return {
      profile: {
        firstName: "L",
        age: 35,
        bodyWeight: 80,
        weightUnit: "kg",
        runningExp: exp,
        hybridExp: exp,
        liftingExp: exp,
        trainingClass: cls,
        trainingDays: WEEK.slice(0, days),
        sex: "male",
        // NO weeklyHours — this is the whole point.
        benchmarks: { fiveKTime: "22:00", tenKTime: "46:00", ski2kTime: "7:30", row2kTime: "7:20" },
      },
      programType: "goal_event",
      durationWeeks: 16,
      races: [{ raceDate: "2026-11-24", priority: "A" }],
      startDate: START,
    } as unknown as GenerationInput;
  }

  it("never ships a third session on a day, and never exceeds a session cap", () => {
    let checked = 0;
    for (const exp of LEVELS) {
      for (const cls of ["non_highly_trained", "highly_trained"] as const) {
        for (const days of LEGACY_DAYS) {
          const input = legacyInput(exp, days, cls);
          const skeleton = buildSkeleton(toEngineInput(input, START));
          const caps = skeleton.caps!;
          const { program } = assembleProgram(skeleton, [], exp, {
            fiveKTime: "22:00",
            tenKTime: "46:00",
          });
          for (const w of program.weeks) {
            for (const d of w.days) {
              const workouts = d.sessions.filter((s) => s.kind !== "race");
              expect(
                workouts.length,
                `${exp}/${cls}/${days}d wk${w.weekNumber} ${d.day}`,
              ).toBeLessThanOrEqual(2);
              for (const s of d.sessions) {
                if (s.kind === "race" || s.kind === "lift") continue;
                const limit = s.kind === "cardio" ? caps.cardioSession : caps.session;
                expect(
                  sessionTiming(s).total,
                  `${exp}/${cls}/${days}d wk${w.weekNumber} ${d.day} ${s.kind}`,
                ).toBeLessThanOrEqual(limit);
                checked++;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it("keeps a bandless day inside the day cap", () => {
    const skeleton = buildSkeleton(
      toEngineInput(legacyInput("advanced", 3, "highly_trained"), START),
    );
    const { program } = assembleProgram(skeleton, [], "advanced", {
      fiveKTime: "22:00",
      tenKTime: "46:00",
    });
    for (const w of program.weeks) {
      for (const d of w.days) {
        const total = d.sessions.reduce((n, s) => n + sessionTiming(s).total, 0);
        expect(total, `wk${w.weekNumber} ${d.day}`).toBeLessThanOrEqual(skeleton.caps!.day);
      }
    }
  });
});
