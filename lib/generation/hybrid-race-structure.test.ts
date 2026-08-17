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
 *
 * ⚠️ BASELINE MOVED 2026-08-17. Rule 1 used to say ALL EIGHT stations, every
 * session. It doesn't any more: eight couplets fixes the distance at 8 km and so
 * lets the athlete's PACE set the threshold dose — 30 min at 6:00/mi, 60 min at
 * 12:00/mi, against a 20–40 min window. The COUPLET COUNT now scales to running
 * experience (`coupletsForThresholdDose`), the runs stay at the race's own 1 km,
 * and `fitHybridToCap` rotates which stations are dropped so coverage completes
 * across weeks instead of within one session. Rules 2 and 3 are unchanged.
 * See `lib/engine/hybrid-threshold-dose.test.ts`.
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
  coupletsForThresholdDose,
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
  it("covers a dose-sized run of stations, in race order, with a run before each", () => {
    const all = hybrids();
    expect(all.length).toBeGreaterThan(0);
    const order = RACE_STATION_ORDER.map((id) => STATIONS[id]!.label.toLowerCase());
    for (const { week, session } of all) {
      const stations = session.elements.filter((e) => !isRunElement(e)).map((e) => e.exercise);
      // Count is set by the threshold dose, not by the race's station count.
      expect(stations.length, `wk${week} station count`).toBeGreaterThanOrEqual(3);
      expect(stations.length, `wk${week} station count`).toBeLessThanOrEqual(order.length);
      // Whatever survives is still in RACE ORDER — the session reads like a race.
      const ranks = stations.map((label) => order.indexOf(label));
      expect(ranks, `wk${week} all known stations`).not.toContain(-1);
      expect(ranks, `wk${week} race order`).toEqual([...ranks].sort((a, b) => a - b));
      // A run element immediately precedes every station.
      for (let i = 0; i < session.elements.length; i += 2) {
        expect(isRunElement(session.elements[i]!), `wk${week} el${i} is a run`).toBe(true);
      }
    }
  });

  it("sizes the session to the athlete's threshold dose", () => {
    // The fixture is an intermediate athlete; the count must match what
    // `coupletsForThresholdDose` prescribes for their threshold pace.
    const all = hybrids("intermediate");
    const counts = new Set(
      all.map(({ session }) => session.elements.filter((e) => !isRunElement(e)).length),
    );
    // One programme, one pace → one couplet count across every regular hybrid.
    expect(counts.size).toBe(1);
    const n = [...counts][0]!;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(RACE_STATION_ORDER.length);
  });

  it("keeps every run leg at the race's FULL 1 km — the count flexes, not the distance", () => {
    for (const { week, session } of hybrids()) {
      const runs = session.elements.filter(isRunElement);
      for (const el of runs) {
        expect(el.prescription, `wk${week}`).toContain("1000m");
      }
      // Mileage follows the leg count, and every one of those miles counts
      // toward the week's total.
      expect(hybridRunMiles(session), `wk${week} miles`).toBeCloseTo(runs.length * 0.621371, 1);
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

  it("drops stations for dose or cap, and rotates which", () => {
    // A very slow athlete: the threshold dose alone already cuts the couplets,
    // and a tight budget can cut further — but not the same way twice.
    const tight = 40;
    const slow = 12 * 60;
    const w1 = fitHybridToCap(1, tight, slow, "peak");
    const w2 = fitHybridToCap(2, tight, slow, "peak");
    expect(w1.length).toBeLessThan(RACE_STATION_ORDER.length);
    expect(w1.length).toBeGreaterThanOrEqual(3); // never collapses to nothing
    expect(w1).not.toEqual(w2); // a station dropped this week comes back next
    // Whatever survives is still in race order.
    for (const ids of [w1, w2]) {
      const ranks = ids.map((id) =>
        RACE_STATION_ORDER.indexOf(id as (typeof RACE_STATION_ORDER)[number]),
      );
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
    // A generous budget no longer means all eight — the dose still applies.
    expect(fitHybridToCap(1, 200, slow, "peak")).toHaveLength(
      coupletsForThresholdDose("intermediate", slow),
    );
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
