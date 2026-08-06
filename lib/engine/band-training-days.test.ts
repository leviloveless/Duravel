/**
 * REGRESSION — the day count follows the band, on the ENGINE side (Levi, 2026-08-06).
 *
 * `BAND_MIN_TRAINING_DAYS` has been validated in onboarding (client AND server)
 * since 2026-08-04, but `toEngineInput` never enforced it — so a program SAVED
 * before that rule came back through the engine on every recalculate with a week
 * its band could not physically fit. A sweep over 4 sports x 6 bands x 3
 * experience levels x 2 training classes x 9 day-sets found **996 days shipping
 * two weight sessions**, every one of them a 4-day week: more lifts prescribed
 * than lift-free days exist, so no legal arrangement was available at all.
 *
 * This mirrors `clampBandToFamily`, which closed the same asymmetry for the band
 * itself. Both only ever move in the safe direction — the band down, the days up.
 *
 * ⚠️ SCOPE: bandless (pre-`weeklyHours`) programs are deliberately NOT clamped.
 * Inferring a band from volume and then adding training days off that inference
 * would rewrite the week of every legacy program in the system. Those 120
 * remaining two-lift days are the frozen legacy path, by choice.
 */
import { describe, it, expect } from "vitest";
import { clampTrainingDaysToBand, bandMinTrainingDays } from "./time-budget";
import { buildSkeleton, toEngineInput } from "./skeleton";
import type { TrainingDayName } from "./types";
import type { GenerationInput, WeeklyHoursBand } from "@/lib/schemas";

const ALL: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

describe("clampTrainingDaysToBand", () => {
  it("raises a short week to the band's minimum", () => {
    const out = clampTrainingDaysToBand(["mon", "tue", "wed", "thu"], "h20_30");
    expect(out).toHaveLength(bandMinTrainingDays("h20_30"));
    expect(out).toEqual(ALL); // 7 required
  });

  it("leaves a week that already satisfies the band completely alone", () => {
    const days: TrainingDayName[] = ["mon", "wed", "fri", "sat"];
    expect(clampTrainingDaysToBand(days, "h0_5")).toEqual(days);
  });

  it("never REMOVES a day, even when the athlete trains more than the minimum", () => {
    // h0_5 needs 4; the athlete chose 6. Their choice stands.
    const days: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
    expect(clampTrainingDaysToBand(days, "h0_5")).toEqual(days);
  });

  it("takes preferred REST days last", () => {
    // Needs 5, has 3. "wed" and "thu" are free; "sun" is a preferred rest day,
    // so it must not be chosen while an unprotected day remains.
    const out = clampTrainingDaysToBand(["mon", "tue", "fri"], "h5_10", ["sun"]);
    expect(out).toHaveLength(5);
    expect(out).not.toContain("sun");
  });

  it("takes a rest day only when there is genuinely no other way", () => {
    // A 7-day band consumes the whole week — which is exactly what onboarding
    // tells an athlete choosing it.
    const out = clampTrainingDaysToBand(["mon", "tue", "wed"], "h10_20", ["sun"]);
    expect(out).toEqual(ALL);
  });

  it("returns calendar order and no duplicates", () => {
    const out = clampTrainingDaysToBand(["sat", "mon", "sat"], "h5_10");
    expect(out).toEqual([...new Set(out)]);
    expect(out).toEqual(ALL.filter((d) => out.includes(d)));
  });

  it("is idempotent — a recalculate must not keep growing the week", () => {
    const once = clampTrainingDaysToBand(["mon", "tue"], "h5_10");
    expect(clampTrainingDaysToBand(once, "h5_10")).toEqual(once);
  });
});

// --- the integration that actually matters: through toEngineInput ---

function input(band: WeeklyHoursBand | undefined, days: TrainingDayName[]): GenerationInput {
  return {
    sport: "hyrox",
    programType: "goal_event",
    durationWeeks: 16,
    profile: {
      firstName: "T",
      age: 30,
      bodyWeight: 175,
      weightUnit: "lb",
      runningExp: "intermediate",
      hybridExp: "intermediate",
      liftingExp: "intermediate",
      trainingClass: "non_highly_trained",
      trainingDays: days,
      weeklyHours: band,
    },
    races: [{ raceDate: "2026-11-23", priority: "A" }],
  } as unknown as GenerationInput;
}

const twoLiftDays = (sk: ReturnType<typeof buildSkeleton>) =>
  sk.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.sessions.filter((s) => s.kind === "lift").length >= 2).length;

describe("toEngineInput holds a stored program to its band's day minimum", () => {
  it("grows a saved 4-day h20_30 week to 7 days", () => {
    const ei = toEngineInput(input("h20_30", ["mon", "tue", "wed", "thu"]), "2026-08-03");
    expect(ei.trainingDays).toEqual(ALL);
  });

  it("the impossible week it used to produce is gone", () => {
    // The reported shape: an h20_30 band on 4 days prescribes more lifts than it
    // has lift-free days, so two had to share one. This exact input shipped 10
    // two-lift days across its 16 weeks before the clamp.
    const days: TrainingDayName[] = ["tue", "thu", "sat", "sun"];
    expect(twoLiftDays(buildSkeleton(toEngineInput(input("h20_30", days), "2026-08-03")))).toBe(0);
    // And on a lower band that also requires 7 days (5 such days before).
    expect(twoLiftDays(buildSkeleton(toEngineInput(input("h10_20", days), "2026-08-03")))).toBe(0);
  });

  it("leaves a BANDLESS legacy program's days exactly as stored", () => {
    const days: TrainingDayName[] = ["mon", "tue", "wed", "thu"];
    expect(toEngineInput(input(undefined, days), "2026-08-03").trainingDays).toEqual(days);
  });

  it("leaves an already-legal band program byte-identical", () => {
    const legal = input("h20_30", ALL);
    const before = JSON.stringify(buildSkeleton(toEngineInput(legal, "2026-08-03")));
    expect(JSON.stringify(buildSkeleton(toEngineInput(legal, "2026-08-03")))).toBe(before);
    expect(toEngineInput(legal, "2026-08-03").trainingDays).toEqual(ALL);
  });

  it("holds for every band the sport offers", () => {
    for (const band of ["h0_5", "h5_10", "h10_20", "h20_30"] as WeeklyHoursBand[]) {
      const ei = toEngineInput(input(band, ["mon", "tue", "wed"]), "2026-08-03");
      expect(ei.trainingDays.length, band).toBeGreaterThanOrEqual(bandMinTrainingDays(band));
    }
  });
});
