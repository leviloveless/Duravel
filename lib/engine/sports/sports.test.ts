import { describe, it, expect } from "vitest";
import { SPORTS, getSport, hyrox } from "./index";
import { STATIONS, RACE_STATION_ORDER } from "../stations";
import { RUN_COUNT, HYBRID_COUNT } from "../slots";
import { PHASE_ZONE_TARGETS, STARTING_MILEAGE, AVG_MIN_PER_MILE } from "../volume";
import { HYBRID_LIBRARY } from "@/lib/ai/philosophy";

describe("sport registry (P0)", () => {
  it("resolves HYROX and defaults unknown/legacy ids to HYROX", () => {
    expect(getSport("hyrox")).toBe(hyrox);
    expect(getSport(undefined)).toBe(hyrox);
    // DEKA/tri/genfit not registered yet at P0 → fall back to HYROX, never crash.
    expect(getSport("deka_fit")).toBe(hyrox);
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
});
