/**
 * A brick's legs carry a target, not just a zone (Levi, 2026-09-20).
 *
 * *"The brick workouts need to indicate the time spent running, time spent
 * cycling, speed for running and wattage for cycling."*
 *
 * Two of those four were already there. The other two are here, plus the guard
 * that matters most: that an athlete with no FTP gets NO number rather than a
 * percentage of a figure they never supplied.
 */
import { describe, it, expect } from "vitest";
import {
  bikeSegmentTarget,
  runSegmentTarget,
  brickSegmentLine,
  type BrickTargets,
} from "./brick-targets";
import { computePaces } from "./paces";

const FTP = 250;
const paces = computePaces("24:00");

const TRIATHLETE: BrickTargets = { ftpWatts: FTP, paces };
/** A HYROX athlete: a 5K time, and no FTP — Levi's 2026-09-20 call. */
const STATION_ATHLETE: BrickTargets = { paces };

describe("wattage for cycling", () => {
  it("reads as watts once an FTP is known", () => {
    const t = bikeSegmentTarget(2, TRIATHLETE);
    expect(t).toMatch(/^\d+–\d+W$/);
  });

  it("uses the same Coggan bands a standalone ride is prescribed in", () => {
    // Zone 2 endurance is 56–75% of FTP in `bikeContent`, so it is here too: a
    // brick's ride is an ordinary ride that happens to be followed by a run.
    expect(bikeSegmentTarget(2, TRIATHLETE)).toBe(
      `${Math.round(FTP * 0.56)}–${Math.round(FTP * 0.75)}W`,
    );
  });

  it("gets harder as the zone does", () => {
    const top = (z: number) => Number(/–(\d+)W/.exec(bikeSegmentTarget(z, TRIATHLETE)!)![1]);
    expect(top(2)).toBeLessThan(top(3));
    expect(top(3)).toBeLessThan(top(4));
    expect(top(4)).toBeLessThan(top(5));
  });

  it("says NOTHING when no FTP was given", () => {
    // The decision, pinned. A "% FTP" band reads like a prescription and is not
    // one — it is a percentage of a number the athlete never supplied.
    expect(bikeSegmentTarget(2, STATION_ATHLETE)).toBeUndefined();
    expect(bikeSegmentTarget(2, {})).toBeUndefined();
    expect(bikeSegmentTarget(2, undefined)).toBeUndefined();
    expect(bikeSegmentTarget(2, { ftpWatts: 0 })).toBeUndefined();
  });
});

describe("speed for running", () => {
  it("reads as a pace per mile", () => {
    expect(runSegmentTarget(2, TRIATHLETE)).toMatch(/^\d+:\d\d\/mi$/);
  });

  it("is available to a station athlete too — every sport has a 5K", () => {
    // The asymmetry is deliberate: FTP is triathlon-only, run benchmarks are
    // not, so a HYROX athlete's authored brick still gets a pace on its run leg.
    expect(runSegmentTarget(2, STATION_ATHLETE)).toBeDefined();
  });

  it("is the EASY pace at Zone 2, not the long-run pace", () => {
    // Both are Zone 2. A brick's run is short and already fatigued; long-run
    // pace is the slower of the two and would under-prescribe it.
    expect(runSegmentTarget(2, TRIATHLETE)).toContain(String(Math.floor(paces!.easy / 60)));
  });

  it("gets faster as the zone rises", () => {
    const sec = (z: number) => {
      const [m, s] = /(\d+):(\d\d)/.exec(runSegmentTarget(z, TRIATHLETE)!)!.slice(1);
      return Number(m) * 60 + Number(s);
    };
    expect(sec(2)).toBeGreaterThan(sec(3));
    expect(sec(3)).toBeGreaterThan(sec(4));
  });

  it("says nothing when the athlete has no run benchmark", () => {
    expect(runSegmentTarget(2, { ftpWatts: FTP })).toBeUndefined();
  });
});

describe("the line the athlete reads", () => {
  const bike = { discipline: "bike", durationMin: 90, goalZone: 2 };
  const run = { discipline: "run", durationMin: 20, goalZone: 2 };

  it("carries all four things Levi asked for", () => {
    const b = brickSegmentLine(bike, TRIATHLETE);
    const r = brickSegmentLine(run, TRIATHLETE);
    expect(b).toContain("90 min"); // time spent cycling
    expect(b).toMatch(/\d+–\d+W/); // wattage for cycling
    expect(r).toContain("20 min"); // time spent running
    expect(r).toMatch(/\d+:\d\d\/mi/); // speed for running
  });

  it("still reads as a sentence when there is no target to give", () => {
    // The zone survives on its own — this is what a station athlete's bike leg
    // looks like, and it must not end in a dangling dash.
    expect(brickSegmentLine(bike, STATION_ATHLETE)).toBe("Bike — 90 min — Zone 2");
    expect(brickSegmentLine(bike, undefined)).toBe("Bike — 90 min — Zone 2");
  });

  it("keeps the zone even when it has a target — the zone is what it is FOR", () => {
    expect(brickSegmentLine(bike, TRIATHLETE)).toContain("Zone 2");
  });

  it("rounds a fractional duration the way the old inline code did", () => {
    expect(brickSegmentLine({ ...bike, durationMin: 89.6 }, undefined)).toContain("90 min");
  });

  it("gives a swim segment no target rather than guessing one", () => {
    // `BrickSegment.discipline` allows "swim". Nothing here knows how to pace
    // one, and inventing a number would be worse than the bare zone.
    const line = brickSegmentLine({ discipline: "swim", durationMin: 15, goalZone: 2 }, TRIATHLETE);
    expect(line).toBe("Swim — 15 min — Zone 2");
  });
});
