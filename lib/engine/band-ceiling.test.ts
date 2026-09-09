/**
 * Per-SPORT weekly-hours ceilings (`MAX_BAND_BY_SPORT`), and the graceful
 * degradation of a program stored at a band that is no longer offered.
 *
 * The family-level ceiling (`MAX_BAND_BY_FAMILY`, 2026-08-04) is covered by
 * `lib/generation/session-legality.test.ts`; this file covers the sport-level
 * override that sits in front of it and the one behaviour that matters most
 * about it — that taking a band away NEVER breaks a program someone already
 * bought at that band.
 */
import { describe, it, expect } from "vitest";
import type { GenerationInput, SportId, WeeklyHoursBand } from "@/lib/schemas";
import {
  MAX_BAND_BY_SPORT,
  WEEKLY_HOURS_ORDER,
  bandAllowedForSport,
  bandsForSport,
  clampBandForSport,
  maxBandForSport,
} from "./time-budget";
import { getSport } from "./sports";
import { buildSkeleton, toEngineInput } from "./skeleton";
import { buildTriProgramData, rebuildTriWeek, triAnchorsFromBenchmarks } from "./sports/triathlon";
import { sessionTiming } from "@/lib/session-volume";

const START = "2026-09-07";

function storedProgram(sport: SportId, band: WeeklyHoursBand): GenerationInput {
  return {
    profile: {
      firstName: "L",
      age: 35,
      bodyWeight: 80,
      weightUnit: "kg",
      runningExp: "advanced",
      hybridExp: "advanced",
      liftingExp: "advanced",
      trainingClass: "non_highly_trained",
      trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      sex: "male",
      weeklyHours: band,
      benchmarks: { fiveKTime: "24:00", cssPace: "1:45", ftpWatts: 260 },
    },
    sport,
    programType: "goal_event",
    durationWeeks: 16,
    races: [{ raceDate: "2026-12-26", priority: "A" }],
    startDate: START,
  } as unknown as GenerationInput;
}

/** Longest week the program actually DELIVERS, in minutes of real sessions. */
function peakDeliveredMinutes(sport: SportId, band: WeeklyHoursBand): number {
  const input = storedProgram(sport, band);
  const skeleton = buildSkeleton(toEngineInput(input, START));
  const program = buildTriProgramData(
    skeleton,
    triAnchorsFromBenchmarks(input.profile.benchmarks),
    "advanced",
  );
  let peak = 0;
  for (const week of program.weeks) {
    let total = 0;
    for (const day of week.days)
      for (const s of day.sessions) if (s.kind !== "race") total += sessionTiming(s).total;
    if (total > peak) peak = total;
  }
  return peak;
}

/** The bottom of a band, in minutes — what selecting it promises at minimum. */
const BAND_FLOOR_MIN: Record<WeeklyHoursBand, number> = {
  h0_5: 0,
  h5_10: 5 * 60,
  h10_20: 10 * 60,
  h20_30: 20 * 60,
  h30_40: 30 * 60,
};

describe("per-sport band ceilings", () => {
  it("keys on the SPORT for triathlon, where the family cannot tell the distances apart", () => {
    expect(MAX_BAND_BY_SPORT.tri_olympic).toBe("h10_20");
    expect(MAX_BAND_BY_SPORT.tri_70_3).toBe("h20_30");
    // 140.6 has no entry — it takes the family default, which is no ceiling.
    expect(MAX_BAND_BY_SPORT.tri_140_6).toBeUndefined();
    expect(maxBandForSport(getSport("tri_140_6"))).toBeUndefined();
  });

  it("falls back to the family ceiling for every sport without its own", () => {
    // The 2026-08-04 station rule is untouched and still reached through the
    // sport-keyed door.
    expect(maxBandForSport(getSport("hyrox"))).toBe("h20_30");
    expect(maxBandForSport(getSport("deka_fit"))).toBe("h20_30");
    expect(bandAllowedForSport(getSport("hyrox"), "h30_40")).toBe(false);
    expect(bandAllowedForSport(getSport("hyrox"), "h20_30")).toBe(true);
    // General fitness has neither a sport nor a family ceiling.
    expect(maxBandForSport(getSport("general_fitness"))).toBeUndefined();
    expect(bandsForSport(getSport("general_fitness"))).toEqual([...WEEKLY_HOURS_ORDER]);
  });

  it("offers onboarding the right radio buttons per triathlon distance", () => {
    expect(bandsForSport(getSport("tri_olympic"))).toEqual(["h0_5", "h5_10", "h10_20"]);
    expect(bandsForSport(getSport("tri_70_3"))).toEqual(["h0_5", "h5_10", "h10_20", "h20_30"]);
    expect(bandsForSport(getSport("tri_140_6"))).toEqual([...WEEKLY_HOURS_ORDER]);
  });

  it("clamps rather than rejects, and never below the ceiling", () => {
    expect(clampBandForSport(getSport("tri_olympic"), "h30_40")).toBe("h10_20");
    expect(clampBandForSport(getSport("tri_olympic"), "h20_30")).toBe("h10_20");
    expect(clampBandForSport(getSport("tri_olympic"), "h5_10")).toBe("h5_10");
    expect(clampBandForSport(getSport("tri_70_3"), "h30_40")).toBe("h20_30");
    expect(clampBandForSport(getSport("tri_140_6"), "h30_40")).toBe("h30_40");
  });

  /**
   * THE CRITERION, EXECUTABLE.
   *
   * A band is a promise of a RANGE of weekly hours, so a sport may only offer it
   * if the sport's biggest week actually reaches the bottom of that range. This
   * is what picked the ceilings above (see `MAX_BAND_BY_SPORT` for the measured
   * table), and pinning it here means a future change to the tri phase caps
   * cannot silently leave a band on the form that the sport can no longer fill.
   *
   * `h30_40` on 140.6 is the one deliberate exception: it delivers 29.6 h
   * against a 30 h floor, a 24-minute miss on a 36-hour prescription, and Levi
   * kept the band. The allowance below is exactly that gap and no more.
   */
  it("every band a tri sport offers is one it can actually fill", () => {
    const ALLOWANCE = 30; // minutes; see above — 140.6 at h30_40 lands 24 min short
    for (const sport of ["tri_olympic", "tri_70_3", "tri_140_6"] as SportId[]) {
      for (const band of bandsForSport(getSport(sport))) {
        if (band === "h0_5") continue; // no meaningful floor
        expect(
          peakDeliveredMinutes(sport, band),
          `${sport} @ ${band} must reach the band's lower bound`,
        ).toBeGreaterThanOrEqual(BAND_FLOOR_MIN[band] - ALLOWANCE);
      }
    }
  });

  it("and the band above the ceiling would NOT have been fillable", () => {
    // The other half of the criterion: the first refused band really is a lie.
    // Olympic at 20-30 h delivers ~12.6 h; 70.3 at 30-40 h delivers ~23 h.
    expect(peakDeliveredMinutes("tri_olympic", "h10_20")).toBeLessThan(BAND_FLOOR_MIN.h20_30);
    expect(peakDeliveredMinutes("tri_70_3", "h20_30")).toBeLessThan(BAND_FLOOR_MIN.h30_40);
  });
});

/**
 * ⚠️ GRACEFUL DEGRADATION — the reason this is a clamp and not a validation
 * error. Olympic-distance athletes could select 30-40 hours until 2026-09-09,
 * and the ones who did have a saved input snapshot that still says so. Every
 * recalculate, every week adaptation and every program view rebuilds from that
 * snapshot, so the band being withdrawn must be invisible to them apart from the
 * week getting honest.
 */
describe("a program stored at a band that is no longer offered", () => {
  it("still recalculates, clamped, instead of failing", () => {
    const stored = storedProgram("tri_olympic", "h30_40");
    const built = () => buildSkeleton(toEngineInput(stored, START));
    expect(built).not.toThrow();

    const skeleton = built();
    expect(skeleton.weeks).toHaveLength(16);
    // It rebuilds as the largest band Olympic actually offers — byte-identical
    // to a program the athlete could still select today.
    expect(skeleton).toEqual(
      buildSkeleton(toEngineInput(storedProgram("tri_olympic", "h10_20"), START)),
    );
    // ...and NOT as the band it was stored at.
    expect(skeleton).not.toEqual(
      buildSkeleton(toEngineInput(storedProgram("tri_140_6", "h30_40"), START)),
    );
  });

  it("brings the session CAPS down with the band, not just the volume", () => {
    // The trap: `toEngineInput` computes caps from the STORED band, so a clamp
    // that only moved `weeklyHours` would build a 10-20 hour week while still
    // allowing 180-minute sessions and 300-minute Zone 2 blocks inside it.
    const clamped = buildSkeleton(toEngineInput(storedProgram("tri_olympic", "h30_40"), START));
    const honest = buildSkeleton(toEngineInput(storedProgram("tri_olympic", "h10_20"), START));
    expect(clamped.caps).toEqual(honest.caps);
    expect(clamped.caps!.session).toBe(120);
    expect(clamped.caps!.cardioSession).toBe(180);
  });

  it("clamps on the week-adaptation path too, not only on a full rebuild", () => {
    // `adapt-week` calls `rebuildTriWeek` with the stored EngineInput directly —
    // it never goes back through `buildSkeleton`, so the clamp has to live at
    // the triathlon engine's door rather than in the full-program builder.
    const stored = toEngineInput(storedProgram("tri_olympic", "h30_40"), START);
    const honest = toEngineInput(storedProgram("tri_olympic", "h10_20"), START);
    const week = buildSkeleton(honest).weeks[10]!;
    const cfg = getSport("tri_olympic");
    expect(rebuildTriWeek(week, stored, cfg)).toEqual(rebuildTriWeek(week, honest, cfg));
  });

  it("leaves a sport whose band is still offered completely alone", () => {
    // 140.6 at 30-40 h is untouched by any of this — the tell that the change
    // landed on the distances it was aimed at.
    const a = buildSkeleton(toEngineInput(storedProgram("tri_140_6", "h30_40"), START));
    expect(Math.max(...a.weeks.map((w) => w.targetCardioMinutes))).toBe(36 * 60);
  });
});
