/**
 * REGRESSION — the triathlon PHASE caps survive the rescaler (Levi, 2026-09-09).
 *
 * `triCardioSlots` has always computed a phase-gated ceiling for the two key
 * sessions of a triathlon week — the long run (150/135 for 140.6, 120/105 for
 * 70.3, 75/60 for Olympic) and the long ride (75% of the race bike distance,
 * capped at 3.5 h outside peak) — and applied them when it built the slots.
 * `fitTriSlotsToTarget` then re-scaled every slot toward the week's time target
 * against `triSlotCap`, which knows `caps.session` and `caps.cardioSession` and
 * nothing whatsoever about a phase. The caps were computed, applied, and thrown
 * away one function later.
 *
 * Measured across 576 generated triathlon weeks (3 sports x 4 hours bands x 3
 * experience levels x 16 weeks) on the path production actually uses —
 * `buildSkeleton` -> `buildTriathlonSkeleton` -> `buildTriProgramData`, no
 * `assembleProgram`, no `reconcile.ts`:
 *
 *   - 634 runs past their own phase long-run cap, the worst by +230 minutes
 *   - 153 long-ride legs past the phase long-ride cap, the worst by +84
 *   - 244 of 1287 non-long runs at 150 minutes or more, topping out at a
 *     **290-minute (4h50) EASY run in an OLYMPIC-distance build** whose race run
 *     is 10 km and whose long run that same week was capped at 75
 *   - the long run was not the longest run of the week in 231 of the 576 weeks
 *
 * Capping the run and the ride then exposed the third discipline, which had no
 * ceiling of any kind: the fitter moved the surplus onto the SWIM, taking swims
 * past two hours from 424 to 577 and past two and a half from 258 to 473. The
 * five-hour Olympic-distance swim at the top of that distribution predates the
 * cap work and was bounded only by `caps.cardioSession`.
 *
 * That last one is the HYROX inversion arriving by a different road, and its
 * cause here is mechanical: the long run was the ONLY run carrying a cap, so
 * every surplus minute the fitter had to place went to the easy runs, which
 * carried none. A cap on one run is not a cap; it is a redirection.
 */
import { describe, it, expect } from "vitest";
import type { GenerationInput, Session, WeeklyHoursBand } from "@/lib/schemas";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { buildTriProgramData, triAnchorsFromBenchmarks } from "../sports/triathlon";
import { sessionTiming } from "@/lib/session-volume";
import { bandMinTrainingDays } from "../time-budget";
import type { PhaseName } from "../types";

const START = "2026-08-10";
const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const BANDS: WeeklyHoursBand[] = ["h5_10", "h10_20", "h20_30", "h30_40"];
const SPORTS = ["tri_olympic", "tri_70_3", "tri_140_6"] as const;
const EXPS = ["beginner", "intermediate", "advanced"] as const;

type Exp = (typeof EXPS)[number];
type RunSession = Extract<Session, { kind: "run" }>;

function gen(sport: string, exp: Exp, band: WeeklyHoursBand): GenerationInput {
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

/** The production path exactly: skeleton, then the deterministic assembler. */
function build(sport: string, exp: Exp, band: WeeklyHoursBand) {
  const input = gen(sport, exp, band);
  const skeleton = buildSkeleton(toEngineInput(input, START));
  const program = buildTriProgramData(
    skeleton,
    triAnchorsFromBenchmarks(input.profile.benchmarks as never),
    exp,
  );
  return { skeleton, program };
}

/**
 * The phase caps, restated here from the policy rather than imported from the
 * engine. A regression test that asks the engine what its own cap is can only
 * ever prove the engine agrees with itself — which it did throughout the whole
 * period these numbers were measured in.
 */
const distanceKey = (sport: string) =>
  sport === "tri_140_6" ? "140_6" : sport === "tri_olympic" ? "olympic" : "70_3";
const LONG_RUN_CAP: Record<string, { peak: number; standard: number }> = {
  "140_6": { peak: 150, standard: 135 },
  "70_3": { peak: 120, standard: 105 },
  olympic: { peak: 75, standard: 60 },
};
const RACE_BIKE_MILES: Record<string, number> = { olympic: 24.8, "70_3": 56, "140_6": 112 };
const LONG_SWIM_CAP: Record<string, { peak: number; standard: number }> = {
  "140_6": { peak: 120, standard: 100 },
  "70_3": { peak: 90, standard: 75 },
  olympic: { peak: 75, standard: 60 },
};

function longRunCap(sport: string, phase: PhaseName): number {
  const c = LONG_RUN_CAP[distanceKey(sport)]!;
  return phase === "peak" ? c.peak : c.standard;
}
function longSwimCap(sport: string, phase: PhaseName): number {
  const c = LONG_SWIM_CAP[distanceKey(sport)]!;
  return phase === "peak" ? c.peak : c.standard;
}
function longRideCap(sport: string, phase: PhaseName): number {
  // 75% of the race bike distance at 16 mph, held to 3.5 h outside peak.
  const distanceCap = Math.round(((0.75 * RACE_BIKE_MILES[distanceKey(sport)]!) / 16) * 60);
  return phase === "peak" ? distanceCap : Math.min(distanceCap, 210);
}

/** Every week of every sport/band/experience combination, with its context. */
function* everyWeek() {
  for (const sport of SPORTS) {
    for (const band of BANDS) {
      for (const exp of EXPS) {
        const { skeleton, program } = build(sport, exp, band);
        for (const [i, w] of program.weeks.entries()) {
          const phase = skeleton.weeks[i]!.phase;
          yield {
            sport,
            band,
            exp,
            phase,
            caps: skeleton.caps!,
            where: `${sport}/${band}/${exp} wk${w.weekNumber} ${phase}`,
            sessions: w.days.flatMap((d) => d.sessions),
          };
        }
      }
    }
  }
}

describe("triathlon phase caps survive the rescaler", () => {
  it("never prescribes a run longer than the week's phase long-run cap", () => {
    // 634 runs failed this, the worst a 290-minute easy run under a 60-minute
    // cap. Asserted over EVERY run, not just the one labelled long: the surplus
    // the fitter could not put on the long run went straight to the easy ones,
    // so a rule that only binds the long run does not bind anything.
    const failures: string[] = [];
    let checked = 0;
    for (const w of everyWeek()) {
      const cap = longRunCap(w.sport, w.phase);
      for (const s of w.sessions) {
        if (s.kind !== "run") continue;
        checked++;
        if (s.durationMin > cap)
          failures.push(`${w.where}: ${s.runType} ${s.durationMin}min vs cap ${cap}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(checked).toBeGreaterThan(1500);
  });

  it("holds the long run to caps.longRun as well as to the phase cap", () => {
    // `caps.longRun` (the athlete's own ceiling — 150 for a triathlete, or their
    // band session cap when that is higher) was never consulted anywhere on the
    // triathlon path. It is the tighter of the two whenever the athlete's band
    // is small and the race is long, which is precisely the athlete who should
    // not be handed a 140.6 peak long run in full.
    const failures: string[] = [];
    for (const w of everyWeek()) {
      for (const s of w.sessions) {
        if (s.kind !== "run" || s.runType !== "long") continue;
        if (sessionTiming(s).total > w.caps.longRun)
          failures.push(
            `${w.where}: long ${sessionTiming(s).total}min vs caps.longRun ${w.caps.longRun}`,
          );
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("never prescribes a ride longer than the week's phase long-ride cap", () => {
    // 153 long-ride brick legs failed this (234 counting the mid-week race
    // bricks), the worst by 84 minutes. The brick matters as much as the plain
    // ride: `scaleSlot` grows a brick PRO RATA, so holding the session total
    // under a cap says nothing about the ride inside it.
    const failures: string[] = [];
    let checked = 0;
    for (const w of everyWeek()) {
      const cap = longRideCap(w.sport, w.phase);
      for (const s of w.sessions) {
        if (s.kind === "bike") {
          checked++;
          if (s.durationMin > cap) failures.push(`${w.where}: bike ${s.durationMin}min vs ${cap}`);
        }
        if (s.kind === "brick") {
          const bike = s.segments.reduce(
            (a, x) => a + (x.discipline === "bike" ? x.durationMin : 0),
            0,
          );
          checked++;
          if (bike > cap) failures.push(`${w.where}: brick ride ${bike}min vs ${cap}`);
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });

  it("never prescribes a swim longer than the week's phase long-swim cap", () => {
    // The swim was the discipline with no ceiling of any kind, and once the run
    // and the ride had theirs it inherited every surplus minute the week could
    // not place: 577 swims past two hours, 473 past two and a half, and a
    // **300-minute swim in an OLYMPIC-distance program** whose race swim is
    // 1500 m. `caps.cardioSession` was the only thing holding it, and that is a
    // statement about the longest Zone 2 BLOCK an athlete can do — written with
    // the long ride in mind, not a pool session.
    const failures: string[] = [];
    let checked = 0;
    for (const w of everyWeek()) {
      const cap = longSwimCap(w.sport, w.phase);
      for (const s of w.sessions) {
        if (s.kind !== "swim") continue;
        checked++;
        if (s.durationMin > cap)
          failures.push(`${w.where}: ${s.sessionType} swim ${s.durationMin}min vs cap ${cap}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });

  it("lets only ONE swim a week reach the long swim's allowance", () => {
    // The same trap the runs sprang: a ceiling on one session of a discipline is
    // a redirection, not a ceiling, because the fitter simply moves the surplus
    // to a sibling that has none. Every other swim is held at the long swim's
    // cap divided by the 1.4 the builder itself uses to size a key session apart
    // from an ordinary one — so the week's spare minutes cannot reappear as a
    // two-hour "technique" swim.
    const failures: string[] = [];
    for (const w of everyWeek()) {
      const ordinary = Math.round(longSwimCap(w.sport, w.phase) / 1.4);
      const big = w.sessions.filter((s) => s.kind === "swim" && s.durationMin > ordinary);
      if (big.length > 1)
        failures.push(
          `${w.where}: ${big.length} swims over the ordinary allowance ${ordinary} ` +
            `(${big.map((s) => (s.kind === "swim" ? s.durationMin : 0)).join(", ")})`,
        );
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("makes the long run the longest run of the week", () => {
    // 231 of 576 weeks (40%) inverted. Measured in RUNNING minutes — the run
    // itself — because that is what the phase cap is denominated in and what the
    // athlete is actually asked to run. Session TOTAL is a different question:
    // a quality run carries roughly twice the fixed warm-up and cool-down of an
    // easy one, six minutes of which is not even on foot, so in the very
    // smallest weeks a 19-minute tempo can still out-total a 25-minute long run.
    const failures: string[] = [];
    let checked = 0;
    for (const w of everyWeek()) {
      const runs = w.sessions.filter((s): s is RunSession => s.kind === "run");
      const long = runs.find((r) => r.runType === "long");
      if (!long || runs.length < 2) continue; // recovery weeks carry no long run
      checked++;
      for (const r of runs) {
        if (r === long) continue;
        if (r.durationMin > long.durationMin)
          failures.push(`${w.where}: ${r.runType} ${r.durationMin} > long ${long.durationMin}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(checked).toBeGreaterThan(400);
  });
});
