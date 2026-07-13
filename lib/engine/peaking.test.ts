import { describe, it, expect } from "vitest";
import { planWeek, assignDays } from "./slots";
import { buildSimulationElements, RACE_STATION_ORDER } from "./stations";
import type { TrainingDayName } from "./types";
import { reconcileWeekVolume } from "../generation/reconcile";
import { computePaces } from "./paces";
import { weekMileage, weekCardioMinutes } from "@/lib/session-volume";
import type { ProgramDay } from "@/lib/schemas";

const DAYS: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat"];

describe("deload preserves intensity while taper cuts frequency (Review #9)", () => {
  it("a deload keeps more run frequency than a taper", () => {
    const deload = planWeek("build", "deload", "intermediate", "intermediate");
    const taper = planWeek("build", "taper", "intermediate", "intermediate");
    expect(deload.runs).toBeGreaterThan(taper.runs);
    expect(deload.runs).toBeGreaterThanOrEqual(3); // long + quality + easy survive
    expect(deload.hybrids).toBeGreaterThanOrEqual(1);
  });

  it("a taper still cuts aggressively for freshness", () => {
    const build = planWeek("build", "increase", "intermediate", "intermediate");
    const taper = planWeek("build", "taper", "intermediate", "intermediate");
    expect(taper.runs).toBeLessThan(build.runs);
    expect(taper.lifts).toBe(2);
  });
});

describe("Peak race-simulation marking", () => {
  const hasSim = (days: ReturnType<typeof assignDays>) =>
    days.some((d) => d.sessions.some((s) => s.kind === "hybrid" && s.simulation === true));

  it("a normal Peak week marks one hybrid as a simulation", () => {
    expect(hasSim(assignDays(DAYS, "peak", "increase", "intermediate", "intermediate"))).toBe(true);
    expect(hasSim(assignDays(DAYS, "peak", "rebound", "intermediate", "intermediate"))).toBe(true);
  });

  it("Base/Build weeks and Peak deloads do NOT", () => {
    expect(hasSim(assignDays(DAYS, "base", "increase", "intermediate", "intermediate"))).toBe(false);
    expect(hasSim(assignDays(DAYS, "build", "increase", "intermediate", "intermediate"))).toBe(false);
    expect(hasSim(assignDays(DAYS, "peak", "deload", "intermediate", "intermediate"))).toBe(false);
  });
});

describe("buildSimulationElements", () => {
  it("is 8 run→station pairs in race order at race spec", () => {
    const els = buildSimulationElements("open", "male");
    expect(els).toHaveLength(16);
    for (let i = 0; i < 16; i += 2) {
      expect(els[i]!.exercise).toBe("run"); // run precedes each station
    }
    expect(els[1]!.prescription).toContain("1000m"); // ski erg (first station)
    expect(els[3]!.prescription).toContain("152kg"); // sled push (2nd station), Open male load
    expect(els.filter((e) => e.exercise === "run")).toHaveLength(8);
    // stations appear in race order
    const stationLabels = els.filter((_, i) => i % 2 === 1).map((e) => e.exercise);
    expect(stationLabels[0]).toContain("skierg");
    expect(stationLabels.length).toBe(RACE_STATION_ORDER.length);
  });

  it("reflects division + sex", () => {
    const proF = buildSimulationElements("pro", "female");
    const farmers = proF.find((e) => e.exercise.includes("farmers"));
    expect(farmers?.prescription).toContain("2×24kg"); // Pro female farmers
  });
});


describe("race simulation is compatible with volume reconciliation", () => {
  it("keeps weekly mileage + cardio exact with a 16-element sim hybrid", () => {
    const P = computePaces("22:00")!;
    const days: ProgramDay[] = [
      { day: "mon", sessions: [{ kind: "run", runType: "easy", durationMin: 40, paceMinMile: "9:00", distanceMiles: 4, goalZone: 2 }] },
      { day: "tue", sessions: [{ kind: "hybrid", goalZone: 4, simulation: true, elements: buildSimulationElements("open", "male") }] },
      { day: "wed", sessions: [{ kind: "run", runType: "long", durationMin: 70, paceMinMile: "9:00", distanceMiles: 8, goalZone: 2 }] },
      { day: "thu", sessions: [] },
    ];
    reconcileWeekVolume(days, 24, 320, P, "intermediate");
    expect(weekMileage({ days })).toBe(24);
    expect(weekCardioMinutes({ days })).toBe(320);
  });
});
