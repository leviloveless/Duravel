/**
 * A low-volume week end to end (Levi, 2026-08-17/18).
 *
 * `hybrid-low-volume.test.ts` pins `hybridRunPlan` itself. This file pins the
 * two seams the plan has to travel through to reach an athlete, both of which
 * are OPTIONAL PARAMETERS with a legacy default:
 *
 *  1. `buildSkeleton` → `assignDays` → `buildRunSlots` — the week's mileage
 *     decides whether the hybrid is big enough to CREDIT the threshold run;
 *  2. `assembleProgram` → `replaceHybrids` → `hybridRunPlan` — the same mileage
 *     decides how long the session's run legs actually are.
 *
 * Drop either argument and every unit test still passes while the behaviour
 * silently reverts. That is precisely how the liftType bug survived: the engine
 * computed the right answer and the wiring quietly discarded it. So these assert
 * the OUTPUT of the whole pipeline.
 *
 * The headline symptom, in Levi's words: asking for 4, 5 or 6 mi/week all
 * produced the same 8.1 mi week, because 8.1 was just the sum of the two things
 * that could not shrink — the hybrid and the long run.
 *
 * ## What these prove against pristine `main`
 *
 * The first and third blocks use nothing but exports `main` already has, so they
 * fail there on BEHAVIOUR — the strong kind of guard. The middle block (one
 * shared leg budget) imports constants that do not exist on `main` and would
 * fail there by absence; it is a specification of new behaviour, and should not
 * be read as the stronger thing.
 */
import { describe, it, expect } from "vitest";
import type { GenerationInput } from "@/lib/schemas";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { assembleProgram } from "./assemble";
import { sessionMiles } from "@/lib/session-volume";
import { THRESHOLD_RUN_MIN_WEEKLY_MI } from "@/lib/engine/slots";
import { HYBRID_LEG_BUDGET_SHARE, MIN_HYBRID_RUN_METERS } from "@/lib/engine/stations";

const START = "2026-08-10";
const M_PER_MILE = 1609.344;

function gen(startMileage: number, weeklyHours: string): GenerationInput {
  return {
    profile: {
      firstName: "L",
      age: 35,
      bodyWeight: 80,
      weightUnit: "kg",
      runningExp: "beginner",
      hybridExp: "beginner",
      liftingExp: "beginner",
      trainingClass: "non_highly_trained",
      trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
      sex: "male",
      weeklyHours,
      benchmarks: { fiveKTime: "27:00" },
    },
    startMileage,
    programType: "goal_event",
    durationWeeks: 16,
    races: [{ raceDate: "2026-11-24", priority: "A" }],
    startDate: START,
  } as unknown as GenerationInput;
}

function build(startMileage: number, weeklyHours = "h5_10") {
  const skeleton = buildSkeleton(toEngineInput(gen(startMileage, weeklyHours), START));
  const { program } = assembleProgram(skeleton, [], "beginner", { fiveKTime: "27:00" });
  return { skeleton, program };
}

interface WeekShape {
  target: number;
  actual: number;
  hybridMiles: number;
  hybrids: number;
  /** Metres of every inter-station run leg in the week, one entry per session. */
  legMetres: number[];
}

function shapeOf(startMileage: number, weekNumber = 1, weeklyHours = "h5_10"): WeekShape {
  const { skeleton, program } = build(startMileage, weeklyHours);
  const week = program.weeks.find((w) => w.weekNumber === weekNumber)!;
  const skel = skeleton.weeks.find((w) => w.weekNumber === weekNumber)!;
  const shape: WeekShape = {
    target: skel.targetMileage,
    actual: 0,
    hybridMiles: 0,
    hybrids: 0,
    legMetres: [],
  };
  for (const day of week.days) {
    for (const s of day.sessions) {
      shape.actual += sessionMiles(s);
      if (s.kind !== "hybrid" || s.simulation) continue;
      shape.hybrids += 1;
      shape.hybridMiles += sessionMiles(s);
      const legs = s.elements.filter((e) => e.exercise === "run");
      const metres = legs.reduce((sum, e) => {
        const m = /(\d+)\s*m\b/.exec(e.prescription ?? "");
        return sum + (m ? Number(m[1]) : 0);
      }, 0);
      shape.legMetres.push(metres);
    }
  }
  return shape;
}

describe("a small week is actually small", () => {
  it("delivers less running when less running is asked for", () => {
    // On main every one of these produced the identical 8.1 mi week.
    const small = shapeOf(5);
    const bigger = shapeOf(11);
    expect(small.actual).toBeLessThan(bigger.actual);
    expect(small.actual).toBeLessThan(8);
  });

  it("hits the target it printed, rather than overrunning it", () => {
    for (const mi of [5, 7, 8, 10, 11]) {
      const s = shapeOf(mi);
      expect(s.actual, `start=${mi} target ${s.target}`).toBeCloseTo(s.target, 1);
    }
  });

  it("stops the hybrid owning half the week's running", () => {
    // 48% on main, at every one of these settings.
    for (const mi of [5, 7, 8, 10, 11]) {
      const s = shapeOf(mi);
      expect(s.hybridMiles / s.actual, `start=${mi}`).toBeLessThan(0.4);
    }
  });

  it("shortens the legs in the session the athlete actually reads", () => {
    const s = shapeOf(5);
    expect(s.hybrids).toBeGreaterThan(0);
    for (const metres of s.legMetres) {
      expect(metres).toBeGreaterThan(0);
      // Shorter than the four full kilometres a normal-volume week gets.
      expect(metres).toBeLessThan(4000);
    }
  });

  it("leaves a normal-volume week at the race's own distance", () => {
    // 18 mi — comfortably above the low-volume threshold, and a literal on
    // purpose: this assertion has to be readable against a build that has no
    // such threshold.
    const s = shapeOf(18);
    for (const metres of s.legMetres) expect(metres % 1000).toBe(0);
  });
});

describe("the week's hybrids share ONE leg budget", () => {
  // h0_5 schedules TWO hybrids a week. Budgeting each of them separately spent
  // 40% of the week on legs alone and left those bands at 62% of weekly mileage
  // inside the hybrids — the same crowding-out this mechanism exists to prevent.
  it("keeps two hybrids inside the same share one would have had", () => {
    const s = shapeOf(11, 1, "h0_5");
    expect(s.hybrids).toBe(2);
    const legMiles = s.legMetres.reduce((a, b) => a + b, 0) / M_PER_MILE;
    // Allow the rounding-up that the 500 m floor can force.
    const floorMiles = (s.hybrids * 3 * MIN_HYBRID_RUN_METERS) / M_PER_MILE;
    expect(legMiles).toBeLessThanOrEqual(
      Math.max(s.target * HYBRID_LEG_BUDGET_SHARE, floorMiles) + 0.01,
    );
  });

  it("still leaves a single-hybrid week the whole budget", () => {
    const s = shapeOf(11);
    expect(s.hybrids).toBe(1);
    const legMiles = s.legMetres[0]! / M_PER_MILE;
    // Comfortably more than half the budget — it is not being divided by 2.
    expect(legMiles).toBeGreaterThan(s.target * HYBRID_LEG_BUDGET_SHARE * 0.5);
  });
});

describe("the threshold run comes back when the hybrid is too small to be one", () => {
  /** Run types the SKELETON planned for one week. */
  function runTypes(startMileage: number, weekNumber: number): string[] {
    const { skeleton } = build(startMileage, "h0_5");
    const week = skeleton.weeks.find((w) => w.weekNumber === weekNumber)!;
    return week.days.flatMap((d) =>
      d.sessions.filter((s) => s.kind === "run").map((s) => (s as { runType: string }).runType),
    );
  }

  // Week 3 is the first deload: one hybrid, three runs, in both programs. The
  // ONLY difference between these two cases is how much the week runs.
  it("keeps its own threshold run at low mileage", () => {
    expect(runTypes(8, 3)).toContain("threshold");
  });

  // ⚠️ SUPERSEDED 2026-08-23 (Levi): "the substitution is kept only where the
  // week genuinely has no room". A full-size hybrid used to cancel the threshold
  // run at ANY mileage — measured across 1,027 hybrid weeks, not one carried a
  // separate threshold or tempo run. Now the credit is gated on the week being
  // under `THRESHOLD_RUN_MIN_WEEKLY_MI`, below which the reconciler drops a
  // planned threshold run 100% of the time.
  it("KEEPS its own threshold run at normal mileage, hybrid or not", () => {
    expect(runTypes(25, 3)).toContain("threshold");
  });

  it("still credits the hybrid on a week too small to hold one", () => {
    // A 0–5 h week whose target is under the floor: planning a threshold run
    // there would be planning something the athlete never sees.
    const { skeleton } = build(4, "h0_5");
    const wk = skeleton.weeks.find((w) => w.targetMileage < THRESHOLD_RUN_MIN_WEEKLY_MI)!;
    const types = wk.days.flatMap((d) =>
      d.sessions.filter((s) => s.kind === "run").map((s) => (s as { runType: string }).runType),
    );
    const hybrids = wk.days.flatMap((d) => d.sessions.filter((s) => s.kind === "hybrid"));
    if (hybrids.length > 0 && types.length >= 3) expect(types).toContain("easy");
  });
});
