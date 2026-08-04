/**
 * REGRESSION — the triathlon builder obeys the same limits as everything else
 * (Levi, 2026-08-04).
 *
 * Triathlon assembles deterministically through `buildTriProgramData`, a path
 * that never touched `reconcile.ts` — so every guard the station-hybrid side has
 * was simply absent here. A real audit of the pre-fix builder found:
 *
 *   - the skeleton returned NO `caps` at all, so nothing bounded any session
 *   - weeks delivered ~1.7x their prescribed minutes (a 10-20 h athlete got 30 h)
 *   - THREE sessions a day, every day
 *   - a single long-ride brick of 666 minutes — ELEVEN HOURS
 *
 * The sessions are sized from a share of the weekly minutes and then grown on top
 * (long ride 1.4x + a run tail, long run 1.4x, race bricks 1.2-1.6x); nothing
 * added the result back up. `fitTriSlotsToTarget` now does.
 */
import { describe, it, expect } from "vitest";
import type { GenerationInput, WeeklyHoursBand } from "@/lib/schemas";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { buildTriProgramData, triAnchorsFromBenchmarks } from "../sports/triathlon";
import { sessionTiming, weekCardioMinutes } from "@/lib/session-volume";
import { bandMinTrainingDays, bandMaxWeeklyMinutes } from "../time-budget";

const START = "2026-08-10";
const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const BANDS: WeeklyHoursBand[] = ["h0_5", "h5_10", "h10_20", "h20_30", "h30_40"];
const SPORTS = ["tri_olympic", "tri_70_3", "tri_140_6"] as const;

function gen(sport: string, exp: "beginner" | "intermediate" | "advanced", band: WeeklyHoursBand) {
  return {
    sport,
    profile: {
      firstName: "L",
      age: 35,
      bodyWeight: 80,
      weightUnit: "kg",
      runningExp: exp,
      hybridExp: exp,
      liftingExp: exp,
      trainingClass: "highly_trained",
      trainingDays: WEEK.slice(0, bandMinTrainingDays(band)),
      sex: "male",
      weeklyHours: band,
      benchmarks: { fiveKTime: "22:00", tenKTime: "46:00", cssPace: "1:30", ftpWatts: 280 },
    },
    programType: "goal_event",
    durationWeeks: 16,
    races: [{ raceDate: "2026-11-24", priority: "A" }],
    startDate: START,
  } as unknown as GenerationInput;
}

function build(sport: string, exp: "beginner" | "intermediate" | "advanced", band: WeeklyHoursBand) {
  const input = gen(sport, exp, band);
  const skeleton = buildSkeleton(toEngineInput(input, START));
  const program = buildTriProgramData(
    skeleton,
    triAnchorsFromBenchmarks(input.profile.benchmarks as never),
    exp,
  );
  return { skeleton, program };
}

describe("triathlon weeks obey the session, day and band limits", () => {
  it("the triathlon skeleton carries caps at all", () => {
    // It returned none — that is why nothing downstream could bound a session.
    for (const sport of SPORTS) {
      const { skeleton } = build(sport, "intermediate", "h10_20");
      expect(skeleton.caps, sport).toBeTruthy();
      expect(skeleton.caps!.session).toBeGreaterThan(0);
      expect(skeleton.caps!.cardioSession).toBeGreaterThanOrEqual(skeleton.caps!.session);
    }
  });

  it("never puts a third session on a day, and never exceeds a session cap", () => {
    let checked = 0;
    for (const sport of SPORTS) {
      for (const band of BANDS) {
        for (const exp of ["beginner", "intermediate", "advanced"] as const) {
          const { skeleton, program } = build(sport, exp, band);
          const caps = skeleton.caps!;
          for (const w of program.weeks) {
            for (const d of w.days) {
              expect(
                d.sessions.length,
                `${sport}/${band}/${exp} wk${w.weekNumber} ${d.day}`,
              ).toBeLessThanOrEqual(2);
              for (const s of d.sessions) {
                if (s.kind === "race" || s.kind === "lift") continue;
                // Same rule as the station-hybrid side: Zone 1-2 gets the long cap.
                const zone = "goalZone" in s ? s.goalZone : 0;
                const limit = zone <= 2 ? caps.cardioSession : caps.session;
                expect(
                  sessionTiming(s).total,
                  `${sport}/${band}/${exp} wk${w.weekNumber} ${d.day} ${s.kind}`,
                ).toBeLessThanOrEqual(limit);
                checked++;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("delivers the prescribed minutes instead of 1.7x them", () => {
    for (const sport of SPORTS) {
      for (const band of BANDS) {
        const { skeleton, program } = build(sport, "intermediate", band);
        program.weeks.forEach((w, i) => {
          const target = skeleton.weeks[i]!.targetCardioMinutes;
          if (target <= 0) return;
          const delivered = weekCardioMinutes(w);
          // Never over; short only when the caps genuinely ran out of room.
          expect(delivered, `${sport}/${band} wk${w.weekNumber}`).toBeLessThanOrEqual(target + 2);
          expect(delivered).toBeGreaterThan(0);
        });
      }
    }
  });

  it("keeps the whole week inside the band the athlete selected, lifts included", () => {
    for (const sport of SPORTS) {
      for (const band of BANDS) {
        for (const exp of ["beginner", "advanced"] as const) {
          const { program } = build(sport, exp, band);
          for (const w of program.weeks) {
            const total = w.days
              .flatMap((d) => d.sessions)
              .reduce((n, s) => n + sessionTiming(s).total, 0);
            expect(total, `${sport}/${band}/${exp} wk${w.weekNumber}`).toBeLessThanOrEqual(
              bandMaxWeeklyMinutes(band),
            );
          }
        }
      }
    }
  });
});
