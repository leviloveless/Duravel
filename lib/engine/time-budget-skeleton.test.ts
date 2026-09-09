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
 * ⚠️ BASELINE MOVED 2026-09-09, deliberately — the four STATION snapshots at
 * h10_20 and h20_30 only. Triathlon and the two low bands are byte-identical,
 * which is again the tell that the change landed where it was aimed.
 *
 * The week now holds day-slots back for Zone 1-2 (`BAND_CARDIO_SLOTS`). The
 * mileage run floor was buying every slot the day count allowed — 13 of 14 on a
 * 7-day h20_30 build — and the aerobic volume those bands actually prescribe had
 * one slot to land in: 1560 cardio minutes prescribed, 580 delivered. Measured
 * across a full 16-week program, delivery went 54% -> 74% at h20_30 and 71% ->
 * 92% at h10_20, with the weekly mileage still hit exactly.
 *
 * What moves in these fixtures is the EASY FILLER: a fartlek and an easy run
 * come off, the long run, the interval and the whole lift dose stay. Note these
 * inputs train 5 days at a band whose minimum is 7 (`BAND_MIN_TRAINING_DAYS`),
 * so they are hand-built `EngineInput`s rather than anything onboarding can
 * produce — through `toEngineInput` the day count is raised to 7 first. On the
 * 5-day shape the reserve is floored at the research session budget, which is
 * why these lose exactly two filler runs and nothing else.
 *
 * ⚠️ BASELINE MOVED 2026-09-09, deliberately — the four TRIATHLON snapshots at
 * h5_10 through h30_40 only. The station snapshots and 70.3 @ h0_5 are
 * byte-identical, which is the tell in the other direction this time: only the
 * triathlon path was touched, and the smallest band was already under every cap.
 *
 * The triathlon builder computed a phase-gated ceiling for the long run
 * (120/105 min at 70.3) and the long ride (75% of the race bike distance), then
 * `fitTriSlotsToTarget` re-scaled every slot against `caps.session` /
 * `caps.cardioSession` and nothing else — so the phase caps were applied and
 * discarded one function later. `caps.longRun` was never consulted on this path
 * at all, and the swim had no ceiling of any kind, so once the run and the ride
 * were bounded it inherited the whole surplus. Across 576 audited weeks: 634
 * runs past their phase long-run cap (worst +230 min), 153 long-ride legs past
 * theirs, and the long run was not even the longest run of the week in 231 of
 * them. All three now read zero.
 *
 * What moves in these fixtures is DURATION and only duration. Session kinds,
 * run types, day placement and every `targetCardioMinutes` are unchanged in all
 * four — the periodization did not move, the sessions inside it got honest. In
 * the h30_40 fixture the longest of each discipline goes
 *
 *     swim 265 -> 90,  non-long run 290 -> 86,  ride 300 -> 113
 *
 * and the week's prescribed minutes fall with them: 25,783 -> 15,263 across the
 * program, a 41% drop. THAT IS THE CHANGE, not a regression to paper over. A
 * 290-minute easy run and a 265-minute swim were how a 30-40 h band was being
 * filled; with them gone the surplus has nowhere legitimate to go, and hours
 * lose to caps — the week lands short and says so. The shortfall scales
 * inversely with race distance exactly as it should: over the full sweep the
 * 140.6 at h30_40 still delivers 76% of its target, the 70.3 62%, and the
 * Olympic — whose race is a 1500 m swim, 40 km ride and 10 km run — 35%.
 *
 * ⚠️ BASELINE MOVED 2026-09-09, deliberately — one snapshot REMOVED and one
 * ADDED. No surviving fixture's contents change, which is the tell this time:
 * the change is about which configurations are OFFERED, not about what any of
 * them generates.
 *
 * The paragraph above is the reason it had to happen. Once the phase caps bind,
 * the shortfall at the top bands scales inversely with race distance — and a
 * shortfall that size is not a tuning problem, it is a band the sport cannot
 * fill. `MAX_BAND_BY_SPORT` therefore stops offering 20-30 h and 30-40 h for
 * Olympic, and 30-40 h for 70.3, exactly the way `MAX_BAND_BY_FAMILY` has
 * stopped offering 30-40 h for the station sports since 2026-08-04.
 *
 *   REMOVED  `70.3 @ h30_40` — the engine clamps that band to h20_30, so the
 *            fixture had become a byte-for-byte duplicate of `70.3 @ h20_30`
 *            recorded under a configuration onboarding no longer renders. This
 *            is precisely why `STATION_BANDS` exists; the tri loop now filters
 *            the same way, through `bandsForSport`.
 *   ADDED    `140.6 @ h30_40` — 140.6 is the only sport that still offers the
 *            top band (29.6 h delivered against a 30 h floor), so it takes over
 *            the job of freezing that band's shape. Without it, removing the
 *            70.3 fixture would leave h30_40 with no snapshot at all.
 *
 * A diff here still means drift. Update these only with a reason written down.
 */
import { describe, it, expect } from "vitest";
import type { EngineInput } from "./types";
import type { SportId, WeeklyHoursBand } from "@/lib/schemas";
import { buildSkeleton } from "./skeleton";
import { bandAllowedForFamily, bandsForSport } from "./time-budget";
import { tri_70_3 } from "./sports/triathlon";

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
function triInput(band: WeeklyHoursBand, sport: SportId = "tri_70_3"): EngineInput {
  return {
    sport,
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
// Same rule, one level finer: 30-40 h is not a 70.3 band either (Levi,
// 2026-09-09 — see `MAX_BAND_BY_SPORT`). The engine clamps it to 20-30, so a
// `70.3 @ h30_40` snapshot would just be a second copy of the h20_30 one under a
// name the product no longer offers. 140.6 still offers the full range and takes
// over as the top-band fixture below.
const TRI_70_3_BANDS = bandsForSport(tri_70_3);

describe("time-budget skeletons (band-driven; snapshots auto-created on first run)", () => {
  for (const band of STATION_BANDS) {
    it(`HYROX @ ${band}`, () => {
      expect(buildSkeleton(hyroxInput(band))).toMatchSnapshot();
    });
    it(`DEKA FIT @ ${band}`, () => {
      expect(buildSkeleton(dekaFitInput(band))).toMatchSnapshot();
    });
  }
  for (const band of TRI_70_3_BANDS) {
    it(`70.3 @ ${band}`, () => {
      expect(buildSkeleton(triInput(band))).toMatchSnapshot();
    });
  }
  // 140.6 is the only sport that still offers 30-40 h, so it carries the fixture
  // that freezes the top band's shape.
  it(`140.6 @ h30_40`, () => {
    expect(buildSkeleton(triInput("h30_40", "tri_140_6"))).toMatchSnapshot();
  });

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
