/**
 * Band-driven skeleton snapshots.
 *
 * ⚠️ BASELINE MOVED 2026-08-13, deliberately. The HYROX and DEKA snapshots
 * move; the triathlon ones do NOT — which is the tell that the change landed
 * where it was aimed, since only station-hybrid sports have hybrids.
 *
 * A hybrid is now 8 km of running at race pace, so it IS the week's threshold
 * session. Scheduling a separate threshold run on top prescribed the same
 * stimulus twice and paid for it out of the easy running (hybrid mileage counts
 * against the week's target). Every changed week reads the same way:
 *
 *     [long, threshold, interval]  →  [long, interval, easy]
 *
 * The interval survives — VO2 work is a stimulus that steady race-pace running
 * does not provide. Session COUNTS and day placement are unchanged; only the
 * run TYPES moved. Across 192 audited weeks this took hard running from 39.1%
 * of weekly mileage to 31.1%, and easy running from 8.2% back up to 19.6%.
 *
 * A diff here still means drift. Update these only with a reason written down.
 */
import { describe, it, expect } from "vitest";
import type { EngineInput } from "./types";
import type { WeeklyHoursBand } from "@/lib/schemas";
import { buildSkeleton } from "./skeleton";
import { bandAllowedForFamily } from "./time-budget";

const BANDS: WeeklyHoursBand[] = ["h0_5", "h5_10", "h10_20", "h20_30", "h30_40"];

function hyroxInput(band: WeeklyHoursBand): EngineInput {
  return {
    sport: "hyrox",
    weeklyHours: band,
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    programType: "goal_event",
    durationWeeks: 16,
    trainingDays: ["mon", "tue", "wed", "thu", "fri"],
    races: [{ weekNumber: 16, priority: "A" }],
  };
}
function triInput(band: WeeklyHoursBand): EngineInput {
  return {
    sport: "tri_70_3",
    weeklyHours: band,
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    swimLevel: "intermediate",
    bikeLevel: "intermediate",
    programType: "goal_event",
    durationWeeks: 16,
    trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
    races: [{ weekNumber: 16, priority: "A" }],
  };
}
function dekaFitInput(band: WeeklyHoursBand): EngineInput {
  return {
    sport: "deka_fit",
    weeklyHours: band,
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    programType: "goal_event",
    durationWeeks: 16,
    trainingDays: ["mon", "tue", "wed", "thu", "fri"],
    races: [{ weekNumber: 16, priority: "A" }],
  };
}

// 30-40 h is not a HYROX/DEKA band (Levi, 2026-08-04) — the engine clamps it to
// 20-30, so snapshotting those two would just duplicate the h20_30 snapshots and
// imply a configuration the product no longer offers. Triathlon keeps all five.
const STATION_BANDS = BANDS.filter((b) => bandAllowedForFamily("station_hybrid", b));

describe("time-budget skeletons (band-driven; snapshots auto-created on first run)", () => {
  for (const band of STATION_BANDS) {
    it(`HYROX @ ${band}`, () => {
      expect(buildSkeleton(hyroxInput(band))).toMatchSnapshot();
    });
    it(`DEKA FIT @ ${band}`, () => {
      expect(buildSkeleton(dekaFitInput(band))).toMatchSnapshot();
    });
  }
  // Triathlon offers the full range, 30-40 h included.
  for (const band of BANDS) {
    it(`70.3 @ ${band}`, () => {
      expect(buildSkeleton(triInput(band))).toMatchSnapshot();
    });
  }

  it("higher budget yields more peak volume (HYROX cardio minutes)", () => {
    const peak = (b: WeeklyHoursBand) =>
      Math.max(...buildSkeleton(hyroxInput(b)).weeks.map((w) => w.targetCardioMinutes));
    expect(peak("h20_30")).toBeGreaterThan(peak("h5_10"));
    expect(peak("h5_10")).toBeGreaterThan(peak("h0_5"));
  });

  it("higher budget yields more peak volume (70.3 cardio minutes)", () => {
    const peak = (b: WeeklyHoursBand) =>
      Math.max(...buildSkeleton(triInput(b)).weeks.map((w) => w.targetCardioMinutes));
    expect(peak("h20_30")).toBeGreaterThan(peak("h5_10"));
    expect(peak("h5_10")).toBeGreaterThan(peak("h0_5"));
  });
});
