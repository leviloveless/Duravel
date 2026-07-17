import { describe, it, expect } from "vitest";
import type { EngineInput } from "../types";
import { buildSkeleton } from "../skeleton";
import { buildSimulationElements, type StationCatalog } from "../stations";
import { analyzeNeeds, type NeedsProfile } from "../needs";
import { getSport } from "./index";
import {
  deka_fit,
  deka_mile,
  deka_strong,
  deka_atlas,
  deka_ultra,
  DEKA_STATIONS,
  ATLAS_STATIONS,
} from "./deka";

const ALL = [deka_fit, deka_mile, deka_strong, deka_atlas, deka_ultra];

function dekaInput(sport: EngineInput["sport"], o: Partial<EngineInput> = {}): EngineInput {
  return {
    sport,
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    programType: "goal_event",
    durationWeeks: 12,
    trainingDays: ["mon", "tue", "wed", "thu", "fri"],
    races: [{ weekNumber: 12, priority: "A" }],
    ...o,
  };
}

function countKind(skel: ReturnType<typeof buildSkeleton>, kind: string): number {
  let n = 0;
  for (const w of skel.weeks) for (const d of w.days) for (const s of d.sessions) if (s.kind === kind) n++;
  return n;
}
function maxRunsPerWeek(skel: ReturnType<typeof buildSkeleton>): number {
  return Math.max(...skel.weeks.map((w) => w.days.reduce((n, d) => n + d.sessions.filter((s) => s.kind === "run").length, 0)));
}
function simRunMeters(cat: StationCatalog): number {
  return buildSimulationElements("open", "male", cat)
    .filter((e) => e.exercise === "run")
    .reduce((sum, e) => sum + (parseInt(e.prescription, 10) || 0), 0);
}

describe("DEKA registry + catalogs", () => {
  it("all 5 DEKA sports resolve", () => {
    expect(getSport("deka_fit")).toBe(deka_fit);
    expect(getSport("deka_mile")).toBe(deka_mile);
    expect(getSport("deka_strong")).toBe(deka_strong);
    expect(getSport("deka_atlas")).toBe(deka_atlas);
    expect(getSport("deka_ultra")).toBe(deka_ultra);
  });

  it("DEKA_STATIONS = 12 specs (10 zones + 2 sibling variants); ATLAS = 10", () => {
    expect(DEKA_STATIONS).toHaveLength(12);
    expect(ATLAS_STATIONS).toHaveLength(10);
  });

  it("catalog matcher maps labels to ids, and disambiguates the zone-4 siblings", () => {
    const m = deka_fit.stationCatalog!.matcher;
    expect(m("Sit-Up Throw")).toBe("deka_sit_up_throw");
    expect(m("Med Ball Sit-Up")).toBe("deka_med_ball_sit_up");
    expect(m("Magnetic Sled Push/Pull")).toBe("deka_sled");
    expect(m("row")).toBe("deka_row");
    expect(m("yoga")).toBeNull();
    expect(deka_atlas.stationCatalog!.matcher("Barbell Thruster")).toBe("atlas_thruster");
  });

  it("all phaseZoneTargets sum to 100 across 5 formats × 4 phases", () => {
    for (const cfg of ALL) {
      for (const phase of ["base", "build", "peak", "taper"] as const) {
        const z = cfg.phaseZoneTargets[phase];
        expect(z.z1 + z.z2 + z.z3 + z.z4 + z.z5).toBe(100);
      }
    }
  });

  it("energy-system ordering: Ultra most aerobic, Mile most anaerobic in base", () => {
    expect(deka_ultra.phaseZoneTargets.base.z2).toBeGreaterThan(deka_fit.phaseZoneTargets.base.z2);
    expect(deka_fit.phaseZoneTargets.base.z2).toBeGreaterThan(deka_mile.phaseZoneTargets.base.z2);
    expect(deka_mile.phaseZoneTargets.peak.z5).toBeGreaterThan(deka_fit.phaseZoneTargets.peak.z5);
  });
});

describe("DEKA needs personalization", () => {
  const ergLimited: NeedsProfile = {
    bodyWeight: 80,
    weightUnit: "kg",
    runningExp: "advanced",
    hybridExp: "intermediate",
    liftingExp: "advanced",
    trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
    sex: "male",
    benchmarks: {
      fiveKTime: "19:30",
      tenKTime: "40:30",
      fiveRmSquat: 150,
      fiveRmDeadlift: 190,
      fiveRmBench: 110,
      ski2kTime: "8:30", // weak erg → the limiter
      row2kTime: "8:20",
      bike20MinCals: 180,
    },
  };

  it("emphasizes DEKA station names (not HYROX names) for a DEKA sport", () => {
    const deka = analyzeNeeds(ergLimited, {
      ergStations: deka_fit.needsStations!.erg,
      strengthStations: deka_fit.needsStations!.strength,
    });
    expect(deka.bias.stationEmphasis).toContain("row"); // DEKA library name
    expect(deka.bias.stationEmphasis).not.toContain("row erg"); // HYROX name absent
    // Default (HYROX) still uses HYROX station names — byte-identical behavior.
    expect(analyzeNeeds(ergLimited).bias.stationEmphasis).toContain("row erg");
  });
});

describe("DEKA simulation geometry", () => {
  it("element counts + run totals per format", () => {
    expect(buildSimulationElements("open", "male", deka_fit.stationCatalog!)).toHaveLength(20); // 10 run + 10 zone
    expect(buildSimulationElements("open", "male", deka_mile.stationCatalog!)).toHaveLength(20);
    expect(buildSimulationElements("open", "male", deka_strong.stationCatalog!)).toHaveLength(10); // zones only
    expect(buildSimulationElements("open", "male", deka_atlas.stationCatalog!)).toHaveLength(10);
    expect(buildSimulationElements("open", "male", deka_ultra.stationCatalog!)).toHaveLength(100); // 5 laps × 20

    expect(simRunMeters(deka_fit.stationCatalog!)).toBe(5000);
    expect(simRunMeters(deka_mile.stationCatalog!)).toBe(1600);
    expect(simRunMeters(deka_strong.stationCatalog!)).toBe(0);
    expect(simRunMeters(deka_atlas.stationCatalog!)).toBe(0);
    expect(simRunMeters(deka_ultra.stationCatalog!)).toBe(25000);
  });

  it("Ultra runs are controlled effort, not threshold", () => {
    const els = buildSimulationElements("open", "male", deka_ultra.stationCatalog!);
    const run = els.find((e) => e.exercise === "run")!;
    expect(run.prescription).toContain("controlled effort");
    expect(run.prescription).not.toContain("threshold");
  });

  it("station prescriptions use DEKA loads (RAM lunge 25kg, farmers 2×27.5kg)", () => {
    const els = buildSimulationElements("open", "male", deka_fit.stationCatalog!);
    const lunge = els.find((e) => e.exercise.includes("lunge"))!;
    expect(lunge.prescription).toContain("25kg");
    const farmers = els.find((e) => e.exercise.includes("farmers"))!;
    expect(farmers.prescription).toContain("2×27.5kg"); // per-hand
  });
});

describe("DEKA skeletons generate", () => {
  it("every DEKA sport builds a valid 12-week skeleton", () => {
    for (const cfg of ALL) {
      const skel = buildSkeleton(dekaInput(cfg.id));
      expect(skel.weeks).toHaveLength(12);
      expect(skel.durationWeeks).toBe(12);
      expect(countKind(skel, "hybrid")).toBeGreaterThan(0);
      expect(countKind(skel, "lift")).toBeGreaterThan(0);
    }
  });

  it("station-only formats (Strong/Atlas) never exceed 1 run/week (floor not resurrected)", () => {
    expect(maxRunsPerWeek(buildSkeleton(dekaInput("deka_strong")))).toBeLessThanOrEqual(1);
    expect(maxRunsPerWeek(buildSkeleton(dekaInput("deka_atlas")))).toBeLessThanOrEqual(1);
  });

  it("running formats (Fit/Mile/Ultra) schedule multiple runs/week", () => {
    expect(maxRunsPerWeek(buildSkeleton(dekaInput("deka_fit")))).toBeGreaterThan(1);
    expect(maxRunsPerWeek(buildSkeleton(dekaInput("deka_ultra")))).toBeGreaterThan(1);
  });

  it("station-only maintenance runs are easy Z2, never long/quality", () => {
    const skel = buildSkeleton(dekaInput("deka_strong"));
    for (const w of skel.weeks) {
      for (const d of w.days) {
        for (const s of d.sessions) {
          if (s.kind === "run") {
            expect(s.runType).toBe("easy");
            expect(s.isLong).toBe(false);
          }
        }
      }
    }
  });
});
