import { describe, it, expect } from "vitest";
import { SPORTS, getSport, hyrox } from "./index";
import {
  STATIONS,
  RACE_STATION_ORDER,
  HYROX_CATALOG,
  buildSimulationElements,
  type StationCatalog,
} from "../stations";
import { RUN_COUNT, HYBRID_COUNT, planWeek, DEFAULT_COUNTS } from "../slots";
import { PHASE_ZONE_TARGETS, STARTING_MILEAGE, AVG_MIN_PER_MILE } from "../volume";
import { HYBRID_LIBRARY } from "@/lib/ai/philosophy";

describe("sport registry (P0)", () => {
  it("resolves HYROX and defaults unknown/legacy ids to HYROX", () => {
    expect(getSport("hyrox")).toBe(hyrox);
    expect(getSport(undefined)).toBe(hyrox);
    // Unknown / legacy ids fall back to HYROX, never crash.
    expect(getSport("not_a_real_sport" as never)).toBe(hyrox);
    expect(SPORTS.hyrox).toBe(hyrox);
  });

  it("HYROX config is a faithful aggregation of the live engine constants (no drift)", () => {
    expect(hyrox.phaseZoneTargets).toBe(PHASE_ZONE_TARGETS);
    expect(hyrox.sessionCounts.run).toBe(RUN_COUNT);
    expect(hyrox.sessionCounts.hybrid).toBe(HYBRID_COUNT);
    expect(hyrox.stations).toBe(STATIONS);
    expect(hyrox.raceStationOrder).toBe(RACE_STATION_ORDER);
    expect(hyrox.philosophy.stationLibrary).toBe(HYBRID_LIBRARY);
    expect(hyrox.volume.kind).toBe("single_currency");
    if (hyrox.volume.kind === "single_currency") {
      expect(hyrox.volume.startMileageByExp).toBe(STARTING_MILEAGE);
      expect(hyrox.volume.avgMinPerMile).toBe(AVG_MIN_PER_MILE);
    }
  });

  it("HYROX declares exactly its historical modalities + race geometry", () => {
    expect(hyrox.modalities).toEqual(["run", "lift", "hybrid", "rest", "race"]);
    expect(hyrox.interStationRunMeters).toBe(1000);
    expect(hyrox.totalRaceRunMeters).toBe(8000);
    expect(hyrox.experienceAxes.map((a): string => a.key)).toEqual(["running", "hybrid", "lifting"]);
    expect(hyrox.programType).toBe("race_peaking");
  });

  it("session counts are injectable — the rewire is live, not cosmetic", () => {
    const custom = {
      ...DEFAULT_COUNTS,
      run: { base: [1, 1, 1], build: [1, 1, 1], peak: [1, 1, 1], taper: [1, 1, 1] } as typeof DEFAULT_COUNTS.run,
      hybrid: { base: 5, build: 5, peak: 5, taper: 5 },
    };
    const def = planWeek("build", "increase", "intermediate", "intermediate");
    const inj = planWeek("build", "increase", "intermediate", "intermediate", undefined, custom);
    expect(inj.runs).toBe(1); // custom run table respected
    expect(inj.hybrids).toBe(5); // custom hybrid table respected
    expect(def.runs).not.toBe(inj.runs); // default differs → injection is real
  });

  it("station catalog is swappable — simulations follow a sport-provided catalog", () => {
    const mini: StationCatalog = {
      stations: { row: { id: "row", label: "Row", meters: 500 } },
      raceOrder: ["row"],
      interStationRunMeters: 500,
      matcher: (e) => (/row/i.test(e) ? "row" : null),
    };
    const els = buildSimulationElements("open", "male", mini);
    expect(els).toHaveLength(2); // 1 run + 1 station
    expect(els[0]!.prescription).toContain("500m"); // custom inter-station run distance
    // HYROX default is unchanged: 8 stations, each preceded by a 1000m run.
    const hyroxEls = buildSimulationElements("open", "male");
    expect(hyroxEls).toHaveLength(HYROX_CATALOG.raceOrder.length * 2);
    expect(hyroxEls[0]!.prescription).toContain("1000m");
    expect(hyrox.stationCatalog).toBe(HYROX_CATALOG);
  });
});
