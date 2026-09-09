/**
 * AN AUTHORED POWER LIFT (Levi, 2026-09-09: "Lift - Power should be an option
 * for the custom program builder").
 *
 * The plumbing already allowed it — `LiftType` has carried "power" since
 * 2026-08-05 and `templateSlot` passes `liftType` straight through — so the
 * change itself was a menu entry. What is worth pinning is everything the menu
 * entry quietly relies on, none of which was true by construction:
 *
 *  1. Nothing RELABELS it. `spreadFullLiftTypes` rewrites lift types to keep two
 *     full-body days apart and will happily turn a lift into "full" or "power" to
 *     do it. An athlete who asked for a power day and got a full-body day would
 *     have no way to tell why.
 *  2. It becomes the RACE's four loaded stations, exactly as an engine-planned
 *     power day does — not a generic "power" session.
 *  3. It is legal in EVERY phase. `POWER` has a scheme for base, build, peak and
 *     taper, so there is no phase where an authored power day should vanish.
 *
 * The whole file runs the deterministic engine — no AI, no I/O.
 */
import { describe, it, expect } from "vitest";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { assembleProgram } from "./assemble";
import { validateTemplate } from "@/lib/engine/template-validate";
import type { Session } from "@/lib/schemas";
import type { WeekTemplate } from "@/lib/engine/types";

const START = "2026-08-17";

const template: WeekTemplate = {
  days: [
    { day: "mon", sessions: [{ kind: "lift", liftType: "power" }] },
    { day: "tue", sessions: [{ kind: "run", runType: "threshold" }] },
    { day: "wed", sessions: [{ kind: "run", runType: "easy" }] },
    { day: "thu", sessions: [{ kind: "hybrid" }] },
    { day: "fri", sessions: [{ kind: "lift", liftType: "upper" }] },
    { day: "sat", sessions: [{ kind: "run", runType: "long" }] },
  ],
};

const gen = () =>
  ({
    profile: {
      firstName: "L",
      age: 35,
      bodyWeight: 80,
      weightUnit: "kg",
      runningExp: "intermediate",
      hybridExp: "intermediate",
      liftingExp: "intermediate",
      trainingClass: "non_highly_trained",
      trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
      sex: "male",
      weeklyHours: "h10_20",
      benchmarks: { fiveKTime: "24:00" },
    },
    startMileage: 25,
    programType: "goal_event",
    durationWeeks: 16,
    races: [{ raceDate: "2026-12-05", priority: "A" }],
    startDate: START,
    weekTemplate: template,
  }) as never;

const { program } = assembleProgram(
  buildSkeleton(toEngineInput(gen(), START)),
  [],
  "intermediate",
  { fiveKTime: "24:00" } as never,
);

const mondayLift = (weekIndex: number) => {
  const mon = program.weeks[weekIndex]!.days.find((d) => d.day === "mon")!;
  return mon.sessions.find((s): s is Extract<Session, { kind: "lift" }> => s.kind === "lift");
};

describe("an authored power lift is the lift the athlete gets", () => {
  // Weeks 1, 7 and 13 land in base, base and peak respectively — enough to show
  // no phase quietly drops or rewrites it.
  for (const [label, i] of [
    ["week 1", 0],
    ["week 7", 6],
    ["week 13", 12],
  ] as const) {
    it(`is still a POWER lift in ${label}`, () => {
      // The relabel guard. `spreadFullLiftTypes` is what would break this.
      expect(mondayLift(i)?.liftType).toBe("power");
    });

    it(`is the race's four loaded stations in ${label}`, () => {
      const movements = mondayLift(i)!.movements;
      expect(movements.map((m) => m.exercise)).toEqual([
        "Sled Push",
        "Sled Pull",
        "Wall Balls",
        "Walking Lunges",
      ]);
      // ...and prescribed as power, not as a heavy strength day.
      for (const m of movements) expect(m.emphasis).toBe("power");
    });
  }

  it("loads the stations at 150% of race weight, the same in every phase", () => {
    // Deliberate, and worth pinning because it looks like a missing progression:
    // HYBRID experience scales the VOLUME and the weight is the same for
    // everyone (Levi's explicit override, 2026-08-25). `applyPowerStations`
    // therefore overrides the phase scheme on a station, so base and peak carry
    // the same load.
    const w1 = mondayLift(0)!.movements[0]!;
    const w13 = mondayLift(12)!.movements[0]!;
    expect(w1.suggestedWeight).toContain("150%");
    expect(w13.suggestedWeight).toBe(w1.suggestedWeight);
  });
});

describe("the validator treats a power day as leg work", () => {
  // `sequencing.ts`'s `isHardLegLift` has always counted power; `template-
  // validate`'s `isLegLift` did not, so an authored power day slipped past the
  // spacing rules without a word. A power day IS leg work — sled push, sled pull
  // and walking lunges are three of its four stations.
  it("warns when a power lift sits the day before a key run", () => {
    const issues = validateTemplate(
      {
        days: [
          { day: "mon", sessions: [{ kind: "lift", liftType: "power" }] },
          { day: "tue", sessions: [{ kind: "run", runType: "interval" }] },
          { day: "sat", sessions: [{ kind: "run", runType: "long" }] },
        ],
      },
      { trainingDays: ["mon", "tue", "sat"] },
    );
    expect(issues.some((i) => i.code === "leg_lift_before_key_run")).toBe(true);
  });

  it("warns on a power lift the day after a lower-body lift", () => {
    const issues = validateTemplate(
      {
        days: [
          { day: "mon", sessions: [{ kind: "lift", liftType: "lower" }] },
          { day: "tue", sessions: [{ kind: "lift", liftType: "power" }] },
          { day: "sat", sessions: [{ kind: "run", runType: "long" }] },
        ],
      },
      { trainingDays: ["mon", "tue", "sat"] },
    );
    expect(issues.some((i) => i.code === "consecutive_leg_lifts")).toBe(true);
  });
});
