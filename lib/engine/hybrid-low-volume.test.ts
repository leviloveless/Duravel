/**
 * A hybrid is fitted to the WEEK, not just to the threshold window
 * (Levi, 2026-08-17).
 *
 * ## The problem
 *
 * `coupletsForThresholdDose` sizes a hybrid by how much threshold running the
 * athlete can absorb. Correct at normal volume, and the wrong question at the
 * bottom: it ignores what the week can AFFORD. Four full 1 km legs plus the
 * 10-min and 5-min jogs cost ~3.8 running miles no matter how small the week is,
 * so a 7.7 mi week spent 49% of all its running inside one session.
 *
 * That made the low end unreachable. Asking the engine for 4, 5 or 6 mi/week all
 * produced the same 7.7 mi week, because 7.7 was simply the sum of the two
 * sessions that could not shrink — the hybrid and the long run
 * (`EASY_LONG_MIN_MI`). It also explains part of the standing
 * "17% of weeks land OVER their stated mileage" finding: when the residual will
 * not fit, `reconcile` deliberately lets the week overrun rather than ship a
 * 13-minute "long run".
 *
 * ## The rule
 *
 * Below `LOW_VOLUME_MILEAGE_THRESHOLD` the run legs get a mileage budget.
 * **Shorten the legs first; drop couplets only when the legs hit their 500 m
 * floor.** Couplet count is the number of DIFFERENT stations rehearsed, which is
 * the point of the session; a 600 m run still trains running on tired legs,
 * whereas a missing station trains nothing.
 *
 * ## The second bug this exposed
 *
 * `hybridCoversThreshold` cancelled the week's separate threshold run whenever a
 * hybrid existed — presence, not substance. Fine while every hybrid was eight
 * full 1 km legs. The moment the session scales down, a low-volume week would
 * lose its threshold run AND have a hybrid too small to be one: the stimulus
 * disappears with nothing reporting it. Same shape as the liftType bug. The
 * credit is now conditional on `HYBRID_THRESHOLD_CREDIT_MINUTES`.
 *
 * ## What this file does and does not prove
 *
 * Run against pristine `main` all 14 fail — but by IMPORT ERROR, because
 * `hybridRunPlan` does not exist there. So this is a specification of new
 * behaviour, not a regression catch for old behaviour, and it should not be read
 * as the stronger thing.
 *
 * The actual regression protection is the band snapshot in
 * `time-budget-skeleton.test.ts`: **only `h0_5` moved.** Every other band, the
 * golden-HYROX oracle and the prompt oracle are byte-identical, which is what
 * demonstrates the blast radius is the low end and nothing else.
 */
import { describe, it, expect } from "vitest";
import {
  hybridRunPlan,
  hybridThresholdMinutes,
  coupletsForThresholdDose,
  HYROX_CATALOG,
  LOW_VOLUME_MILEAGE_THRESHOLD,
  HYBRID_LEG_BUDGET_SHARE,
  MIN_HYBRID_RUN_METERS,
  MIN_HYBRID_COUPLETS,
  HYBRID_THRESHOLD_CREDIT_MINUTES,
  buildHybridElements,
} from "./stations";
import type { ExperienceLevel } from "./types";

const M_PER_MILE = 1609.344;
const PACE = 525; // 8:45/mi threshold — Levi's own, where the dose gives 4 couplets
const LEVELS: ExperienceLevel[] = ["beginner", "intermediate", "advanced"];

describe("at or above the threshold, nothing changes", () => {
  it("returns the race distance and the pure dose count", () => {
    for (const exp of LEVELS) {
      for (const mi of [12, 15, 20, 40]) {
        const plan = hybridRunPlan(mi, exp, PACE);
        expect(plan.runMeters, `${exp} @ ${mi}mi`).toBe(HYROX_CATALOG.interStationRunMeters);
        expect(plan.couplets, `${exp} @ ${mi}mi`).toBe(coupletsForThresholdDose(exp, PACE));
      }
    }
  });

  it("an unknown weekly mileage is left alone — legacy callers stay identical", () => {
    for (const exp of LEVELS) {
      const plan = hybridRunPlan(undefined, exp, PACE);
      expect(plan.runMeters).toBe(HYROX_CATALOG.interStationRunMeters);
      expect(plan.couplets).toBe(coupletsForThresholdDose(exp, PACE));
    }
    expect(hybridRunPlan(Number.NaN, "beginner", PACE).runMeters).toBe(1000);
  });
});

describe("below the threshold the legs shorten before the count drops", () => {
  it("shortens legs while the count holds at the dose", () => {
    const dose = coupletsForThresholdDose("beginner", PACE);
    for (const mi of [8, 10, 11]) {
      const plan = hybridRunPlan(mi, "beginner", PACE);
      expect(plan.couplets, `${mi}mi keeps the dose count`).toBe(dose);
      expect(plan.runMeters, `${mi}mi shortens`).toBeLessThan(1000);
      expect(plan.runMeters).toBeGreaterThanOrEqual(MIN_HYBRID_RUN_METERS);
    }
  });

  it("drops couplets only once the legs are already at the 500 m floor", () => {
    const plan = hybridRunPlan(5, "beginner", PACE);
    expect(plan.runMeters).toBe(MIN_HYBRID_RUN_METERS);
    expect(plan.couplets).toBe(MIN_HYBRID_COUPLETS);
  });

  it("never goes below the minimum that still resembles a race", () => {
    // Under this the week runs honestly over budget rather than shipping a
    // two-station "hybrid" — the same choice `reconcile` makes for a long run.
    for (const mi of [0, 1, 2, 3, 4]) {
      const plan = hybridRunPlan(mi, "beginner", PACE);
      expect(plan.couplets, `${mi}mi`).toBe(MIN_HYBRID_COUPLETS);
      expect(plan.runMeters, `${mi}mi`).toBe(MIN_HYBRID_RUN_METERS);
    }
  });

  it("is monotonic — more weekly mileage never buys a smaller session", () => {
    let prev = 0;
    for (let mi = 1; mi <= 20; mi += 0.5) {
      const p = hybridRunPlan(mi, "beginner", PACE);
      const metres = p.runMeters * p.couplets;
      expect(metres, `${mi}mi went backwards`).toBeGreaterThanOrEqual(prev);
      prev = metres;
    }
  });

  it("keeps the boundary smooth rather than cliff-edged", () => {
    const below = hybridRunPlan(LOW_VOLUME_MILEAGE_THRESHOLD - 0.1, "beginner", PACE);
    const at = hybridRunPlan(LOW_VOLUME_MILEAGE_THRESHOLD, "beginner", PACE);
    const belowMi = (below.runMeters * below.couplets) / M_PER_MILE;
    const atMi = (at.runMeters * at.couplets) / M_PER_MILE;
    // A step, but a small one — under a third of a mile.
    expect(atMi - belowMi).toBeLessThan(0.35);
    expect(atMi).toBeGreaterThan(belowMi);
  });

  it("respects the stated budget share wherever the floors are not binding", () => {
    for (const mi of [7, 8, 9, 10, 11]) {
      const p = hybridRunPlan(mi, "beginner", PACE);
      const legMiles = (p.runMeters * p.couplets) / M_PER_MILE;
      expect(legMiles, `${mi}mi over budget`).toBeLessThanOrEqual(mi * HYBRID_LEG_BUDGET_SHARE);
    }
  });

  it("prescribes the shortened distance in the session text", () => {
    const plan = hybridRunPlan(8, "beginner", PACE);
    const els = buildHybridElements(
      "base",
      "open",
      "male",
      HYROX_CATALOG,
      [],
      HYROX_CATALOG.raceOrder.slice(0, plan.couplets),
      plan.runMeters,
    );
    const run = els.find((e) => e.exercise === "run");
    expect(run?.prescription).toContain(`${plan.runMeters}m`);
    expect(run?.prescription).not.toContain("1000m");
  });
});

describe("station-only formats have no runs to budget", () => {
  it("leaves a zero-run catalog completely alone", () => {
    const stationOnly = { ...HYROX_CATALOG, interStationRunMeters: 0 };
    const plan = hybridRunPlan(5, "beginner", PACE, stationOnly);
    expect(plan.runMeters).toBe(0);
    expect(plan.couplets).toBe(stationOnly.raceOrder.length);
  });
});

describe("the threshold credit follows the dose, not the session's existence", () => {
  it("a full-distance hybrid still clears the credit floor", () => {
    for (const exp of LEVELS) {
      const plan = hybridRunPlan(20, exp, PACE);
      expect(hybridThresholdMinutes(plan, PACE), exp).toBeGreaterThanOrEqual(
        HYBRID_THRESHOLD_CREDIT_MINUTES,
      );
    }
  });

  it("a scaled-down hybrid does NOT — which is what restores the threshold run", () => {
    // 3 x 500 m is about eight minutes at threshold. Cancelling a whole
    // threshold session for that is how the stimulus used to vanish silently.
    const plan = hybridRunPlan(5, "beginner", PACE);
    expect(hybridThresholdMinutes(plan, PACE)).toBeLessThan(HYBRID_THRESHOLD_CREDIT_MINUTES);
  });

  it("a station-only hybrid can never credit a threshold run", () => {
    const stationOnly = { ...HYROX_CATALOG, interStationRunMeters: 0 };
    const plan = hybridRunPlan(20, "advanced", PACE, stationOnly);
    expect(hybridThresholdMinutes(plan, PACE)).toBe(0);
  });

  it("falls back to a reference pace when the athlete has no benchmark", () => {
    // The skeleton runs BEFORE `computePaces`, so this is the path production
    // actually takes for the credit decision. It must be finite and sensible.
    const plan = hybridRunPlan(20, "beginner", null);
    const mins = hybridThresholdMinutes(plan, null);
    expect(mins).toBeGreaterThan(0);
    expect(Number.isFinite(mins)).toBe(true);
  });
});
