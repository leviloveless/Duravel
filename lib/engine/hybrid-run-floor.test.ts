/**
 * THE FLOOR MAY NEVER EXCEED THE RACE'S OWN LEG.
 *
 * `MIN_HYBRID_RUN_METERS = 500` exists so a budget-squeezed hybrid still
 * rehearses something race-like: below 500 m an inter-station run stops being a
 * run and starts being a jog between exercises. Good rule, wrong shape — it was
 * applied as `Math.max(500, …)` against every format, and **DEKA MILE's race
 * legs are 160 m.**
 *
 * So from the day the low-volume path shipped, a DEKA MILE athlete under
 * 12 mi/week was prescribed `500 m` legs — more than THREE TIMES the race
 * distance — on the one format whose entire identity is short sprints. The
 * guard against under-racing was quietly enforcing over-racing, and only to the
 * lowest-volume athletes.
 *
 * Found while measuring something else entirely: an experiment that widened the
 * budget made total hybrid mileage go UP, which is impossible if the budget only
 * ever shortens legs. Every week that increased was DEKA MILE. **An unexplained
 * result in the wrong direction is the finding.**
 *
 * ⚠️ SHIPPED ONCE ALREADY AND LOST. This landed on 2026-09-12 and did not
 * survive into `origin/main` — the legal-page half of that commit did, the
 * engine half did not. Re-applied 2026-09-20. If it goes missing again, look at
 * how the commit reached the device rather than at the engine.
 */
import { describe, it, expect } from "vitest";
import { hybridRunPlan, hybridRunFloor, MIN_HYBRID_RUN_METERS } from "./stations";
import { getSport } from "./sports";

const STATION_SPORTS = ["hyrox", "deka_fit", "deka_mile", "deka_ultra"] as const;

/** Weekly mileages below the low-volume threshold, where the budget binds. */
const LOW_MILEAGES = [4, 6, 8, 10, 11];

describe("hybridRunFloor", () => {
  it("is the 500 m floor for a race whose legs are longer", () => {
    expect(hybridRunFloor(1000)).toBe(MIN_HYBRID_RUN_METERS);
    expect(hybridRunFloor(500)).toBe(MIN_HYBRID_RUN_METERS);
  });

  it("is the RACE's leg for a race whose legs are shorter", () => {
    expect(hybridRunFloor(160)).toBe(160);
    expect(hybridRunFloor(200)).toBe(200);
  });
});

describe("no station sport is ever prescribed a leg longer than its own race", () => {
  for (const id of STATION_SPORTS) {
    const cat = getSport(id).stationCatalog;
    if (!cat || cat.interStationRunMeters <= 0) continue;

    it(`${id} (race legs ${cat.interStationRunMeters} m)`, () => {
      for (const exp of ["beginner", "intermediate", "advanced"] as const)
        for (const mi of LOW_MILEAGES)
          for (const hybrids of [1, 2]) {
            const plan = hybridRunPlan(mi, exp, 500, cat, hybrids);
            expect(
              plan.runMeters,
              `${id} ${exp} ${mi}mi x${hybrids} → ${plan.couplets} x ${plan.runMeters} m`,
            ).toBeLessThanOrEqual(cat.interStationRunMeters);
          }
    });
  }
});

describe("DEKA MILE specifically — the format the floor was breaking", () => {
  const cat = getSport("deka_mile").stationCatalog!;

  it("prescribes the race's own 160 m sprint at every weekly mileage", () => {
    // Not "at most 160" — exactly 160. A DEKA MILE athlete should be running
    // DEKA MILE legs whatever their volume; the COUNT is what flexes.
    for (const mi of [...LOW_MILEAGES, 12, 20, 30]) {
      expect(hybridRunPlan(mi, "intermediate", 500, cat).runMeters, `${mi} mi`).toBe(160);
    }
  });

  it("used to be handed 500 m — a 3.1x over-prescription", () => {
    // The regression guard, stated as the arithmetic that made it wrong rather
    // than as a magic number.
    expect(MIN_HYBRID_RUN_METERS / cat.interStationRunMeters).toBeGreaterThan(3);
    expect(hybridRunPlan(8, "intermediate", 500, cat).runMeters).not.toBe(MIN_HYBRID_RUN_METERS);
  });
});

describe("the fix changes nothing for the races it was never about", () => {
  it("HYROX keeps the 500 m floor it has always had", () => {
    const cat = getSport("hyrox").stationCatalog!;
    expect(hybridRunPlan(4, "intermediate", 500, cat).runMeters).toBe(500);
    expect(hybridRunPlan(11, "intermediate", 500, cat).runMeters).toBe(500);
  });

  it("DEKA FIT's 500 m race leg is exactly the floor, so it is untouched", () => {
    const cat = getSport("deka_fit").stationCatalog!;
    for (const mi of LOW_MILEAGES)
      expect(hybridRunPlan(mi, "intermediate", 500, cat).runMeters).toBe(500);
  });
});
