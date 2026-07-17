import { describe, it, expect } from "vitest";
import { computeDekaPacingPlan } from "./deka-pacing";
import { getSport } from "./sports";
import { deka_fit, deka_strong, deka_ultra, deka_atlas } from "./sports/deka";

describe("DEKA pacing plan", () => {
  it("returns null for HYROX and non-station sports", () => {
    expect(computeDekaPacingPlan(getSport("hyrox"), {})).toBeNull();
    expect(computeDekaPacingPlan(getSport("tri_70_3"), {})).toBeNull();
    expect(computeDekaPacingPlan(getSport("general_fitness"), {})).toBeNull();
  });

  it("builds a 10-zone FIT plan with running and a predicted finish", () => {
    const plan = computeDekaPacingPlan(deka_fit, {})!;
    expect(plan).not.toBeNull();
    expect(plan.zones).toHaveLength(10);
    expect(plan.hasRunning).toBe(true);
    expect(plan.totalRunMeters).toBe(5000);
    expect(plan.runSplitSecPerKm).toBeGreaterThan(0);
    expect(plan.runTotalSec).toBeGreaterThan(0);
    expect(plan.source).toBe("predicted");
    // finish = running + zones (all laps) + transitions
    expect(plan.targetFinishSec).toBe(plan.runTotalSec + plan.zonesTotalSec + plan.transitionSec);
  });

  it("STRONG has no running; finish is zones + transitions only", () => {
    const plan = computeDekaPacingPlan(deka_strong, {})!;
    expect(plan.hasRunning).toBe(false);
    expect(plan.runTotalSec).toBe(0);
    expect(plan.runSplitSecPerKm).toBe(0);
    expect(plan.targetFinishSec).toBe(plan.zonesTotalSec + plan.transitionSec);
  });

  it("ULTRA folds 5 laps into the totals", () => {
    const fit = computeDekaPacingPlan(deka_fit, {})!;
    const ultra = computeDekaPacingPlan(deka_ultra, {})!;
    expect(ultra.laps).toBe(5);
    expect(ultra.totalRunMeters).toBe(25000);
    // Same per-lap zone list, 5× the total zone work.
    expect(ultra.zonesTotalSec).toBe(fit.zonesTotalSec * 5);
    expect(ultra.targetFinishSec).toBeGreaterThan(fit.targetFinishSec * 3);
  });

  it("individualizes ski/row zones from erg benchmarks", () => {
    const base = computeDekaPacingPlan(deka_fit, {})!;
    const fast = computeDekaPacingPlan(deka_fit, { benchmarks: { ski2kTime: "6:40", row2kTime: "6:40" } })!;
    const ski = (p: typeof base) => p.zones.find((z) => z.id === "deka_ski")!.targetSec;
    const row = (p: typeof base) => p.zones.find((z) => z.id === "deka_row")!.targetSec;
    // 6:40 2k → 100s per 500m, faster than the 120/110 reference.
    expect(ski(fast)).toBeLessThan(ski(base));
    expect(row(fast)).toBeLessThan(row(base));
    expect(ski(fast)).toBe(100);
  });

  it("scales toward a goal finish", () => {
    const predicted = computeDekaPacingPlan(deka_fit, {})!;
    const goalSec = Math.round(predicted.predictedFinishSec * 0.85);
    const mm = Math.floor(goalSec / 60);
    const ss = goalSec % 60;
    const plan = computeDekaPacingPlan(deka_fit, { goalFinishTime: `${mm}:${String(ss).padStart(2, "0")}` })!;
    expect(plan.source).toBe("goal");
    expect(plan.targetFinishSec).toBeLessThan(predicted.targetFinishSec);
  });

  it("Atlas uses the heavier Atlas catalog (10 zones, no running)", () => {
    const plan = computeDekaPacingPlan(deka_atlas, {})!;
    expect(plan.zones).toHaveLength(10);
    expect(plan.hasRunning).toBe(false);
    expect(plan.zones.some((z) => z.id.startsWith("atlas_"))).toBe(true);
  });
});
