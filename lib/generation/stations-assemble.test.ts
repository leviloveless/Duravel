/**
 * Station volume: a REGULAR hybrid trains at HALF race spec, a SIMULATION at
 * full, and the load is race load in both (Levi, 2026-08-12).
 *
 * ⚠️ BASELINE MOVED 2026-08-12, deliberately. These tests used to assert that a
 * plain hybrid hit full race distance at peak (50 m sled, 100 wall balls). The
 * rule changed: every hybrid now covers every event, and the price of that
 * coverage is half the volume — race intensity at a dose the athlete can absorb
 * twice a week. Full race spec survives in exactly one place, the peak race
 * SIMULATION, which is why the third test here matters more than the other two:
 * it is the invariant that did NOT move.
 *
 * The phase ramp is unchanged and still multiplies through (base 0.6, build
 * 0.85, peak 1.0), so a half-volume station still progresses across the block
 * instead of prescribing the same session in week 1 and week 10.
 */
import { describe, it, expect } from "vitest";
import { applyStationProgression } from "./assemble";
import { HYBRID_STATION_SCALE, EMPHASIS_BOOST } from "@/lib/engine/stations";
import type { ProgramWeek } from "@/lib/schemas";

function hybridWeek(phase: ProgramWeek["phase"], simulation = false): ProgramWeek {
  return {
    weekNumber: 1,
    phase,
    microWeek: "rebound",
    summary: {
      totalCardioMinutes: 0,
      totalMileage: 0,
      zoneDistribution: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
    },
    days: [
      {
        day: "mon",
        sessions: [
          {
            kind: "hybrid",
            goalZone: 4,
            ...(simulation ? { simulation: true } : {}),
            elements: [
              { exercise: "run", prescription: "1000m @ 7:30 (threshold)" },
              { exercise: "sled push", prescription: "40m" },
              { exercise: "run", prescription: "1000m @ 7:30 (threshold)" },
              { exercise: "wall balls", prescription: "50 reps" },
            ],
          },
        ],
      },
    ],
  };
}

describe("applyStationProgression", () => {
  it("trains a regular hybrid at half race volume, at race load, and leaves runs alone", () => {
    const w = hybridWeek("peak");
    applyStationProgression(w, "open", "male");
    const hy = w.days[0]!.sessions[0]!;
    if (hy.kind !== "hybrid") throw new Error("expected hybrid");
    expect(hy.elements[0]!.prescription).toContain("threshold"); // run untouched
    expect(hy.elements[1]!.prescription).toContain("152kg"); // Open male race load
    expect(hy.elements[1]!.prescription).toContain("25m"); // half of the 50 m race distance
    expect(hy.elements[3]!.prescription).toContain("50 reps"); // half of 100 wall balls
  });

  it("still ramps by phase underneath the half-volume rule", () => {
    const w = hybridWeek("base");
    applyStationProgression(w, "open", "male");
    const hy = w.days[0]!.sessions[0]!;
    if (hy.kind !== "hybrid") throw new Error("expected hybrid");
    // 50 m × 0.6 (base) × 0.5 (half) = 15 m — a base hybrid is lighter than a
    // peak one, which is the whole point of keeping the phase factor.
    expect(hy.elements[1]!.prescription).toContain("15m");
    expect(hy.elements[1]!.prescription).toContain("152kg"); // race load throughout
  });

  it("leaves a RACE SIMULATION at full race spec — the one full-volume hybrid", () => {
    const w = hybridWeek("peak", true);
    applyStationProgression(w, "open", "male");
    const hy = w.days[0]!.sessions[0]!;
    if (hy.kind !== "hybrid") throw new Error("expected hybrid");
    expect(hy.elements[1]!.prescription).toContain("50m"); // full race distance
    expect(hy.elements[3]!.prescription).toContain("100 reps"); // full wall balls
    expect(hy.elements[1]!.prescription).toContain("152kg");
  });

  it("gives the athlete's limiter stations extra volume", () => {
    const w = hybridWeek("peak");
    applyStationProgression(w, "open", "male", undefined, ["sled_push"]);
    const hy = w.days[0]!.sessions[0]!;
    if (hy.kind !== "hybrid") throw new Error("expected hybrid");
    // 50 m × 0.5 × 1.2 = 30 m, rounded to 5s — more than the 25 m a non-limiter
    // station gets, and still well short of race distance.
    expect(hy.elements[1]!.prescription).toContain("30m");
    // The station the athlete is fine at is untouched by the emphasis.
    expect(hy.elements[3]!.prescription).toContain("50 reps");
    expect(HYBRID_STATION_SCALE * EMPHASIS_BOOST).toBeCloseTo(0.6);
  });
});
