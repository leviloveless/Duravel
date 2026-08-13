/**
 * Every hybrid trains every event, at half volume, off a FULL race-distance run
 * (Levi, 2026-08-12).
 *
 * The ask: "changing the hybrid workouts to include some work for each of the
 * events. We should do half the volume of each event and the full volume of each
 * run. We want to match race intensity but at a lower volume so the user can
 * recover."
 *
 * Before this, hybrid content was whatever the AI chose — a subset of stations,
 * at volumes with no relationship to race spec, which `applyStationProgression`
 * then rewrote to FULL phase volume anyway. So the model was really only picking
 * WHICH stations, and no session covered all eight events.
 *
 * The three rules pinned here:
 *
 *  1. COVERAGE — all 8 race stations, in race order, every session.
 *  2. HALF the station volume, but the FULL between-station run. The runs are
 *     deliberately not halved: Levi's call that holding race pace over the real
 *     1 km is the thing worth rehearsing.
 *  3. The phase ramp still multiplies through underneath, so a base hybrid is
 *     lighter than a peak one. A flat half would have prescribed the identical
 *     session in week 1 and week 10.
 *
 * Plus the two things that make it safe: the session is billed at what it
 * actually costs (not `elements.length * 5`), and it is trimmed to fit the
 * athlete's own session cap rather than shipping a workout nobody can complete.
 */
import { describe, it, expect } from "vitest";
import type { GenerationInput } from "@/lib/schemas";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { assembleProgram } from "./assemble";
import { sessionTiming, hybridRunMiles } from "@/lib/session-volume";
import {
  RACE_STATION_ORDER,
  STATIONS,
  HYBRID_STATION_SCALE,
  estimateHybridWorkMinutes,
  buildHybridElements,
  fitHybridToCap,
  isRunElement,
} from "@/lib/engine/stations";

const START = "2026-08-10";

function gen(exp: "beginner" | "intermediate" | "advanced"): GenerationInput {
  return {
    profile: {
      firstName: "L",
      age: 35,
      bodyWeight: 80,
      weightUnit: "kg",
      runningExp: exp,
      hybridExp: exp,
      liftingExp: exp,
      trainingClass: "highly_trained",
      trainingDays: ["mon", "tue", "wed", "thu", "fri"],
      sex: "male",
      weeklyHours: "h10_20",
      benchmarks: { fiveKTime: "22:00", tenKTime: "46:00" },
    },
    programType: "goal_event",
    durationWeeks: 16,
    races: [{ raceDate: "2026-11-24", priority: "A" }],
    startDate: START,
  } as unknown as GenerationInput;
}

function program(exp: "beginner" | "intermediate" | "advanced") {
  const skeleton = buildSkeleton(toEngineInput(gen(exp), START));
  return assembleProgram(skeleton, [], exp, { fiveKTime: "22:00", tenKTime: "46:00" }).program;
}

/** Every non-simulation hybrid in a program, with its week. */
function hybrids(exp: "beginner" | "intermediate" | "advanced" = "intermediate") {
  const out: Array<{
    week: number;
    phase: string;
    session: Extract<
      ReturnType<typeof program>["weeks"][number]["days"][number]["sessions"][number],
      { kind: "hybrid" }
    >;
  }> = [];
  for (const w of program(exp).weeks) {
    for (const d of w.days) {
      for (const s of d.sessions) {
        if (s.kind === "hybrid" && !s.simulation)
          out.push({ week: w.weekNumber, phase: w.phase, session: s });
      }
    }
  }
  return out;
}

describe("a hybrid is the race's own structure at a trainable dose", () => {
  it("covers every race station, in race order, with a run before each", () => {
    const all = hybrids();
    expect(all.length).toBeGreaterThan(0);
    for (const { week, session } of all) {
      const stations = session.elements.filter((e) => !isRunElement(e)).map((e) => e.exercise);
      expect(stations, `wk${week} station count`).toHaveLength(RACE_STATION_ORDER.length);
      // Race order, and a run element immediately before every station.
      const expected = RACE_STATION_ORDER.map((id) => STATIONS[id]!.label.toLowerCase());
      expect(stations, `wk${week} order`).toEqual(expected);
      for (let i = 0; i < session.elements.length; i += 2) {
        expect(isRunElement(session.elements[i]!), `wk${week} el${i} is a run`).toBe(true);
      }
    }
  });

  it("runs the FULL race distance between stations — 8 km, not 4", () => {
    for (const { week, session } of hybrids()) {
      for (const el of session.elements.filter(isRunElement)) {
        expect(el.prescription, `wk${week}`).toContain("1000m");
      }
      // 8 × 1000 m = 4.97 mi, and it counts toward the week's mileage.
      expect(hybridRunMiles(session), `wk${week} miles`).toBeCloseTo(4.97, 1);
    }
  });

  it("halves the station volume and still ramps it by phase", () => {
    const byPhase = new Map<string, string>();
    for (const { phase, session } of hybrids()) {
      const wallBalls = session.elements.find((e) => /wall/i.test(e.exercise));
      if (wallBalls && !byPhase.has(phase)) byPhase.set(phase, wallBalls.prescription);
    }
    // 100 reps at race spec → 30 / 45 / 50 across base / build / peak, i.e.
    // HALF of the 60 / 85 / 100 a full-volume station would have prescribed.
    expect(byPhase.get("base")).toContain("30 reps");
    expect(byPhase.get("build")).toContain("45 reps");
    expect(byPhase.get("peak")).toContain("50 reps");
    expect(HYBRID_STATION_SCALE).toBe(0.5);
  });

  it("bills the session for what it costs, not for how many elements it has", () => {
    for (const { week, session } of hybrids()) {
      const timing = sessionTiming(session);
      expect(session.workMin, `wk${week} has a real estimate`).toBeGreaterThan(0);
      // The old proxy was a flat elements.length * 5 = 80 for every one of these.
      expect(timing.work, `wk${week} is not the old flat proxy`).toBe(session.workMin);
    }
  });

  it("a slower athlete is billed MORE for the same session", () => {
    const els = buildHybridElements("peak");
    const fast = estimateHybridWorkMinutes(els, 6 * 60); // 6:00/mi
    const slow = estimateHybridWorkMinutes(els, 11 * 60); // 11:00/mi
    expect(slow).toBeGreaterThan(fast);
    // 8 km is ~5 miles, so 5 min/mi of difference is ~25 min of session.
    expect(slow - fast).toBeGreaterThan(20);
  });

  it("never ships a hybrid past the athlete's session cap", () => {
    for (const exp of ["beginner", "intermediate", "advanced"] as const) {
      const skeleton = buildSkeleton(toEngineInput(gen(exp), START));
      const cap = skeleton.caps!.session;
      const { program: p } = assembleProgram(skeleton, [], exp, {
        fiveKTime: "22:00",
        tenKTime: "46:00",
      });
      for (const w of p.weeks) {
        for (const d of w.days) {
          for (const s of d.sessions) {
            if (s.kind !== "hybrid" || s.simulation) continue;
            expect(sessionTiming(s).total, `${exp} wk${w.weekNumber} ${d.day}`).toBeLessThanOrEqual(
              cap,
            );
          }
        }
      }
    }
  });

  it("drops stations only when the cap forces it, and rotates which", () => {
    // A punishing case: a very slow athlete against a tight budget. Full
    // coverage cannot fit, so coverage degrades — but not the same way twice.
    const tight = 40;
    const slow = 12 * 60;
    const w1 = fitHybridToCap(1, tight, slow, "peak");
    const w2 = fitHybridToCap(2, tight, slow, "peak");
    expect(w1.length).toBeLessThan(RACE_STATION_ORDER.length);
    expect(w1.length).toBeGreaterThanOrEqual(4); // never collapses to nothing
    expect(w1).not.toEqual(w2); // a station dropped this week comes back next
    // Whatever survives is still in race order.
    for (const ids of [w1, w2]) {
      const ranks = ids.map((id) =>
        RACE_STATION_ORDER.indexOf(id as (typeof RACE_STATION_ORDER)[number]),
      );
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
    // A generous budget keeps all eight.
    expect(fitHybridToCap(1, 200, slow, "peak")).toHaveLength(RACE_STATION_ORDER.length);
  });

  it("leaves the peak race SIMULATION at full race spec", () => {
    let sims = 0;
    for (const w of program("intermediate").weeks) {
      for (const d of w.days) {
        for (const s of d.sessions) {
          if (s.kind !== "hybrid" || !s.simulation) continue;
          sims++;
          const wallBalls = s.elements.find((e) => /wall/i.test(e.exercise));
          expect(wallBalls?.prescription).toContain("100 reps"); // full, not half
          expect(s.workMin, "a simulation is billed honestly too").toBeGreaterThan(0);
        }
      }
    }
    expect(sims, "the fixture should reach peak and produce a simulation").toBeGreaterThan(0);
  });
});
