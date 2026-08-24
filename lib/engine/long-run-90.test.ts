/**
 * The long run's ceiling belongs to the RACE, not to the weekly-hours band
 * (Levi, 2026-08-23: "For hyrox, limit long runs to 90 minutes, but for
 * triathlon programs the long run can extend longer than 2 hours").
 *
 * Before this, the long run answered to `caps.session` like every other session,
 * so it inherited the band ceiling: 90/105/120 by experience, lifted to 120/150/180
 * on the high-volume bands. Measured across 1,080 generated weeks, **88 long runs
 * ran past 90 minutes and the longest reached 145** — an athlete training for a
 * one-hour race being sent out for two and a half hours, and paying for it in the
 * sessions that actually rehearse the race.
 *
 * After: **zero over 90, longest exactly 90.**
 *
 * ## Why it took four call sites
 *
 * The cap has to hold everywhere a run's distance is written, or the loops put
 * the miles back: `maxMiles` when the entry is built, `enforceLongRun`'s ramp,
 * the residual snap, and `adjustRunMilesToTotal` — the convergence loop, which
 * was the one that mattered. Patching only the first three left the same ten
 * weeks at 92–98 min, because convergence grows the longest run toward
 * `caps.session` to make the week's arithmetic come out.
 *
 * ## What it costs, honestly
 *
 * Weeks landing more than 0.25 mi under their target went 14 → 20 of 1,152
 * (1.7%). When the long run may not take the miles and nothing else can hold
 * them, the week reports short — the same trade the jump cap already documents.
 *
 * `trainingCaps` exists on `main` and returns no `longRun`, so these fail there
 * on BEHAVIOUR (`undefined`), not by absence.
 */
import { describe, it, expect } from "vitest";
import { buildSkeleton, toEngineInput } from "./index";
import { assembleProgram } from "@/lib/generation/assemble";
import { sessionTiming } from "@/lib/session-volume";
import { trainingCaps } from "./caps";

const exp = (l: "beginner" | "intermediate" | "advanced") => ({
  runningExp: l,
  hybridExp: l,
  liftingExp: l,
});

describe("the cap is set by the sport, not the band", () => {
  it("holds a HYROX long run to 90 minutes even for an advanced athlete", () => {
    const caps = trainingCaps("station_hybrid", exp("advanced"));
    expect(caps.session).toBe(120);
    expect(caps.longRun).toBe(90);
  });

  it("holds it at 90 on the highest-volume band too — the band lifts everything else", () => {
    const caps = trainingCaps("station_hybrid", exp("advanced"), "h30_40");
    expect(caps.session).toBeGreaterThan(90);
    expect(caps.longRun).toBe(90);
  });

  it("lets a TRIATHLON long run past two hours", () => {
    const caps = trainingCaps("triathlon", exp("beginner"));
    expect(caps.longRun).toBeGreaterThan(120);
  });

  it("never LOWERS a triathlete's ceiling below their band's session cap", () => {
    const caps = trainingCaps("triathlon", exp("advanced"), "h30_40");
    expect(caps.longRun).toBeGreaterThanOrEqual(caps.session);
  });

  it("treats general fitness like the station sports", () => {
    expect(trainingCaps("general_fitness", exp("advanced")).longRun).toBe(90);
  });
});

describe("end to end: no HYROX long run runs past 90 minutes", () => {
  const START = "2026-08-17";
  function longRuns(startMileage: number, hours: string, level: "intermediate" | "advanced") {
    const input = {
      profile: {
        firstName: "L",
        age: 35,
        bodyWeight: 80,
        weightUnit: "kg",
        ...exp(level),
        trainingClass: "non_highly_trained",
        trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
        sex: "male",
        weeklyHours: hours,
        benchmarks: { fiveKTime: "24:00" },
      },
      startMileage,
      programType: "goal_event",
      durationWeeks: 16,
      races: [{ raceDate: "2026-12-05", priority: "A" }],
      startDate: START,
    } as never;
    const { program } = assembleProgram(buildSkeleton(toEngineInput(input, START)), [], level, {
      fiveKTime: "24:00",
    } as never);
    return program.weeks
      .flatMap((w) => w.days.flatMap((d) => d.sessions))
      .filter((s) => s.kind === "run" && s.runType === "long")
      .map((s) => sessionTiming(s).total);
  }

  // A 30 mi/week athlete is where this bit: these exact programs shipped 92–98
  // minute long runs, and the convergence loop was the culprit.
  for (const [start, hours, level] of [
    [30, "h0_5", "advanced"],
    [30, "h20_30", "advanced"],
    [30, "h20_30", "intermediate"],
  ] as const) {
    it(`${hours} ${level} starting at ${start} mi`, () => {
      const runs = longRuns(start, hours, level);
      expect(runs.length).toBeGreaterThan(0);
      expect(Math.max(...runs)).toBeLessThanOrEqual(90);
    });
  }

  it("still gives them a real long run — this is a ceiling, not a haircut", () => {
    const runs = longRuns(30, "h20_30", "advanced");
    expect(Math.max(...runs)).toBeGreaterThan(70);
  });
});
