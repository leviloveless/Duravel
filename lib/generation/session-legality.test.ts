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

const START = "2026-08-10";

/** Levi's rule: 0-5 h needs 3 days, 5-10 h needs 5, 10+ h needs 7. */
const REQUIRED_DAYS: Record<WeeklyHoursBand, string[]> = {
  h0_5: ["mon", "wed", "fri"],
  h5_10: ["mon", "tue", "wed", "thu", "fri"],
  h10_20: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  h20_30: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  h30_40: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
};

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
      trainingDays: REQUIRED_DAYS[band],
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
