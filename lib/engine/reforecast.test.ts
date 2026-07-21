import { describe, it, expect } from "vitest";
import { projectTimes, type ProjectionContext } from "./progression";
import { reforecast, type ReforecastContext } from "./reforecast";
import { eventBand } from "./hyrox-standards";

const PCTX: ProjectionContext = {
  runningExp: "intermediate",
  hybridExp: "intermediate",
  weeks: 12,
  sex: "male",
  division: "open",
  age: 30,
};

const SINGLES = {
  hyroxRunTotal: "45:00",
  hyroxSkiErg: "4:30",
  hyroxSledPush: "3:00",
  hyroxSledPull: "5:00",
  hyroxBurpeeBroadJump: "5:30",
  hyroxRow: "4:40",
  hyroxFarmersCarry: "2:10",
  hyroxSandbagLunge: "5:00",
  hyroxWallBalls: "7:00",
  hyroxRoxzone: "7:30",
};

const baseline = projectTimes(SINGLES, PCTX, "singles");
const base = (extra: Partial<ReforecastContext> = {}): ReforecastContext => ({
  weeksW: 12,
  weekK: 6,
  adherence: 1,
  sex: "male",
  division: "open",
  age: 30,
  ...extra,
});

describe("reforecast", () => {
  it("at week 0 reproduces the baseline (now = imported, end = original target)", () => {
    const r = reforecast(baseline, base({ weekK: 0, adherence: 0 }));
    const run = r.perEvent.find((e) => e.key === "hyroxRunTotal")!;
    const bRun = baseline.perEvent.find((e) => e.key === "hyroxRunTotal")!;
    expect(run.nowSec).toBeCloseTo(bRun.currentSec, 0);
    expect(run.endSec).toBeCloseTo(bRun.projectedSec, 0);
    expect(r.finishEndSec!).toBeCloseTo(baseline.finishProjectedSec!, 0);
  });

  it("full adherence keeps the end target on the original plan", () => {
    const r = reforecast(baseline, base({ weekK: 6, adherence: 1 }));
    expect(r.finishEndSec!).toBeCloseTo(baseline.finishProjectedSec!, 0);
    expect(r.onTrack).toBe(true);
  });

  it("higher adherence projects a faster now and end than lower adherence", () => {
    const hi = reforecast(baseline, base({ adherence: 1 }));
    const lo = reforecast(baseline, base({ adherence: 0.3 }));
    const run = (r: typeof hi) => r.perEvent.find((e) => e.key === "hyroxRunTotal")!;
    expect(run(hi).nowSec).toBeLessThan(run(lo).nowSec);
    expect(run(hi).endSec).toBeLessThan(run(lo).endSec);
    expect(lo.note).toMatch(/behind/i);
  });

  it("a fresh measurement pulls 'now' toward the measured time", () => {
    const withM = reforecast(baseline, base({ measurements: { hyroxRunTotal: 2500 } }));
    const without = reforecast(baseline, base());
    const run = (r: typeof withM) => r.perEvent.find((e) => e.key === "hyroxRunTotal")!;
    expect(run(withM).measured).toBe(true);
    expect(run(withM).nowSec).toBeLessThan(run(without).nowSec); // 2500 < model → faster
    expect(without.perEvent.every((e) => !e.measured)).toBe(true);
  });

  it("never projects below the elite floor even for an absurd measurement", () => {
    const floor = eventBand("hyroxRunTotal", "male", "open", 30).F * 0.98;
    const r = reforecast(baseline, base({ measurements: { hyroxRunTotal: 100 } }));
    expect(r.perEvent.find((e) => e.key === "hyroxRunTotal")!.nowSec).toBeGreaterThanOrEqual(floor);
  });

  it("progress percent rises with elapsed weeks", () => {
    const early = reforecast(baseline, base({ weekK: 2 }));
    const late = reforecast(baseline, base({ weekK: 10 }));
    const run = (r: typeof early) => r.perEvent.find((e) => e.key === "hyroxRunTotal")!;
    expect(run(late).progressPct).toBeGreaterThan(run(early).progressPct);
  });

  it("doubles baseline re-forecasts running only, no finish", () => {
    const dbl = projectTimes(SINGLES, PCTX, "doubles");
    const r = reforecast(dbl, base());
    expect(r.perEvent.map((e) => e.key)).toEqual(["hyroxRunTotal"]);
    expect(r.finishNowSec).toBeNull();
    expect(r.finishEndSec).toBeNull();
  });
});
