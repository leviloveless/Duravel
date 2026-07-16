import { describe, it, expect } from "vitest";
import { stationPrescription, stationIdFor, STATIONS } from "./stations";

describe("stationIdFor", () => {
  it("maps free-text names to canonical stations", () => {
    expect(stationIdFor("Ski Erg")).toBe("ski_erg");
    expect(stationIdFor("row erg")).toBe("row");
    expect(stationIdFor("sled push")).toBe("sled_push");
    expect(stationIdFor("sandbag lunges")).toBe("sandbag_lunge");
    expect(stationIdFor("wall balls")).toBe("wall_balls");
    expect(stationIdFor("assault bike")).toBe("assault_bike");
    expect(stationIdFor("yoga")).toBeNull();
  });
});

describe("stationPrescription — race loads, progressed volume", () => {
  it("uses exact race loads (fixed implements), not scaled weights", () => {
    for (const phase of ["base", "build", "peak", "taper"] as const) {
      const p = stationPrescription("sled push", phase, "open", "male")!;
      expect(p.loadKg).toBe(STATIONS.sled_push.loadKg!.open!.male); // 152 every phase
    }
    expect(stationPrescription("wall balls", "base", "open", "female")!.loadKg).toBe(4);
  });

  it("progresses volume 60% → 85% → 100% toward race spec", () => {
    const base = stationPrescription("ski erg", "base")!;
    const build = stationPrescription("ski erg", "build")!;
    const peak = stationPrescription("ski erg", "peak")!;
    expect(base.meters).toBe(600);
    expect(build.meters).toBe(850);
    expect(peak.meters).toBe(1000);
    expect(peak.atRaceSpec).toBe(true);
    expect(base.atRaceSpec).toBe(false);
  });

  it("division changes load; sex changes load", () => {
    expect(stationPrescription("farmers carry", "peak", "pro", "male")!.loadKg).toBe(32);
    expect(stationPrescription("farmers carry", "peak", "open", "female")!.loadKg).toBe(16);
  });

  it("formats per-hand carries and loaded stations", () => {
    expect(stationPrescription("farmers carry", "peak", "open", "male")!.prescription).toContain("2×24kg");
    expect(stationPrescription("sled push", "peak", "open", "male")!.prescription).toContain("@ 152kg");
  });

  it("returns null for unknown exercises (AI text kept)", () => {
    expect(stationPrescription("foam rolling", "peak")).toBeNull();
  });
});
