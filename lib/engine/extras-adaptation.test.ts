/**
 * Off-plan work feeds the adaptation (Levi, 2026-08-18).
 *
 * This reverses the 2026-08-13 arrangement, where extras reached the week
 * header's Actual line and nothing else. That was safe for the CREDIT rules and
 * wrong for the LOAD rules: ACWR exists to catch a load spike, and a spike
 * assembled out of self-added sessions was invisible to the one metric whose job
 * is seeing it — so an athlete could pile two hard sessions onto an increase
 * week and still be handed an earned bump on top of the scheduled progression.
 *
 * What this file pins down is the boundary, because "extras count" is not the
 * same as "extras count for everything":
 *
 *  - compliance, strain, session-RPE load and actual volume: YES
 *  - PLANNED mileage/minutes: never — the athlete adding a run does not change
 *    what the engine asked for, and the revised targets are measured against it
 *  - compliance above 100%: never — over-delivery surfaces as load, not as a
 *    percentage that would read as nonsense on the review screen
 *  - completing a KEY session: never — an extra 5-miler is not the long run
 */
import { describe, it, expect } from "vitest";
import type { ExtraWorkout, ProgramWeek, WorkoutLog } from "@/lib/schemas";
import type { WeekSkeleton } from "./types";
import { computeWeekSignals, decideAdaptation, type AdaptContext } from "./adapt";
import { computeLoadMetrics } from "./load";
import { ADAPT } from "./adapt-config";

// ---- fixtures ----

/** A 6-session week: easy run, upper lift, tempo run, lower lift, hybrid, long run. */
function makeWeek(weekNumber = 5): ProgramWeek {
  return {
    weekNumber,
    phase: "base",
    microWeek: "increase",
    summary: {
      totalCardioMinutes: 240,
      totalMileage: 24,
      zoneDistribution: { z1: 25, z2: 60, z3: 8, z4: 4, z5: 3 },
    },
    days: [
      {
        day: "mon",
        sessions: [
          {
            kind: "run",
            runType: "easy",
            durationMin: 40,
            paceMinMile: "9:00",
            distanceMiles: 4.5,
            goalZone: 2,
          },
        ],
      },
      {
        day: "tue",
        sessions: [
          {
            kind: "lift",
            liftType: "upper",
            movements: [{ pattern: "horizontal_press", sets: 4, repRange: "12-15" }],
          },
        ],
      },
      {
        day: "wed",
        sessions: [
          {
            kind: "run",
            runType: "tempo",
            durationMin: 30,
            paceMinMile: "7:30",
            distanceMiles: 4,
            goalZone: 4,
          },
        ],
      },
      {
        day: "thu",
        sessions: [
          {
            kind: "lift",
            liftType: "lower",
            movements: [{ pattern: "squat", sets: 4, repRange: "12-15" }],
          },
        ],
      },
      {
        day: "fri",
        sessions: [
          {
            kind: "hybrid",
            goalZone: 4,
            elements: [{ exercise: "row erg", prescription: "1000m" }],
          },
        ],
      },
      {
        day: "sat",
        sessions: [
          {
            kind: "run",
            runType: "long",
            durationMin: 90,
            paceMinMile: "9:15",
            distanceMiles: 10,
            goalZone: 2,
          },
        ],
      },
      { day: "sun", sessions: [] },
    ],
  };
}

function makeNextSkeleton(overrides: Partial<WeekSkeleton> = {}): WeekSkeleton {
  return {
    weekNumber: 6,
    phase: "base",
    microWeek: "increase",
    targetMileage: 25.5,
    targetCardioMinutes: 255,
    zoneTargets: { z1: 25, z2: 60, z3: 8, z4: 4, z5: 3 },
    days: [],
    ...overrides,
  };
}

function makeCtx(overrides: Partial<AdaptContext> = {}): AdaptContext {
  return {
    reviewedTargets: { targetMileage: 24, targetCardioMinutes: 240 },
    nextWeek: makeNextSkeleton(),
    prevCompliance: null,
    prevStrain: null,
    lastRule: null,
    ...overrides,
  };
}

function log(
  day: WorkoutLog["day"],
  sessionIndex: number,
  status: WorkoutLog["status"],
  rpe: number | null = 5,
  weekNumber = 5,
): WorkoutLog {
  return { weekNumber, day, sessionIndex, status, rpe, actuals: null, note: null };
}

let extraId = 0;
function extra(over: Partial<ExtraWorkout> = {}): ExtraWorkout {
  return {
    id: `x${++extraId}`,
    weekNumber: 5,
    day: "sun",
    kind: "run",
    ...over,
  } as ExtraWorkout;
}

/**
 * Three of the six planned sessions done — a 50% week on the plan alone.
 *
 * The KEY sessions (long run, quality run) are the ones that got done, and the
 * two lifts plus the hybrid are what got skipped. That is deliberate: skipping
 * the long run trips `protect_long_run`, which matches BEFORE the compliance
 * rules and would mask whatever the extras did to the numbers.
 */
function halfLogged(): WorkoutLog[] {
  return [
    log("mon", 0, "completed"),
    log("wed", 0, "completed"),
    log("sat", 0, "completed"),
    log("tue", 0, "skipped", null),
    log("thu", 0, "skipped", null),
    log("fri", 0, "skipped", null),
  ];
}

// ============================================================
// Compliance
// ============================================================

describe("compliance counts extras", () => {
  it("credits an extra like a completed session", () => {
    const week = makeWeek();
    const planOnly = computeWeekSignals(week, halfLogged());
    expect(planOnly.compliance).toBe(0.5);

    const withExtras = computeWeekSignals(week, halfLogged(), [
      extra({ kind: "run", durationMin: 40, distanceMiles: 4 }),
      extra({ kind: "lift", durationMin: 55 }),
    ]);
    // 3 completed + 2 extras over 6 planned.
    expect(withExtras.compliance).toBe(0.83);
    expect(withExtras.extraSessions).toBe(2);
  });

  it("keeps the plan-only figure alongside it, so the two can be told apart", () => {
    const s = computeWeekSignals(makeWeek(), halfLogged(), [extra(), extra()]);
    expect(s.plannedCompliance).toBe(0.5);
    expect(s.compliance).toBe(0.83);
  });

  it("never exceeds 100%, however much extra work was done", () => {
    // Ten extras on top of a fully-completed week is still a completed week.
    const all = [
      log("mon", 0, "completed"),
      log("tue", 0, "completed"),
      log("wed", 0, "completed"),
      log("thu", 0, "completed"),
      log("fri", 0, "completed"),
      log("sat", 0, "completed"),
    ];
    const extras = Array.from({ length: 10 }, () => extra({ durationMin: 30, rpe: 6 }));
    const s = computeWeekSignals(makeWeek(), all, extras);
    expect(s.compliance).toBe(1);
    // The over-delivery is not lost — it shows up as load instead.
    expect(s.weeklyLoad).toBeGreaterThan(computeWeekSignals(makeWeek(), all).weeklyLoad);
  });

  it("ignores extras belonging to a different week", () => {
    const s = computeWeekSignals(makeWeek(5), halfLogged(), [
      extra({ weekNumber: 4 }),
      extra({ weekNumber: 6 }),
    ]);
    expect(s.extraSessions).toBe(0);
    expect(s.compliance).toBe(0.5);
  });

  it("carries a week of nothing but extras — this is the point of the change", () => {
    const s = computeWeekSignals(
      makeWeek(),
      [],
      [extra({ kind: "cardio", durationMin: 60, rpe: 4, goalZone: 2 })],
    );
    expect(s.plannedCompliance).toBe(0);
    expect(s.compliance).toBeCloseTo(1 / 6, 2);
    expect(s.actualCardioMinutes).toBe(60);
  });
});

// ============================================================
// Volume
// ============================================================

describe("actual volume counts extras, planned volume does not", () => {
  it("leaves the PLANNED figures exactly where they were", () => {
    const week = makeWeek();
    const planOnly = computeWeekSignals(week, halfLogged());
    const withExtras = computeWeekSignals(week, halfLogged(), [
      extra({ kind: "run", durationMin: 60, distanceMiles: 7 }),
    ]);
    expect(withExtras.plannedMileage).toBe(planOnly.plannedMileage);
    expect(withExtras.plannedCardioMinutes).toBe(planOnly.plannedCardioMinutes);
  });

  it("adds an extra run's minutes and miles to the actuals", () => {
    const base = computeWeekSignals(makeWeek(), halfLogged());
    const s = computeWeekSignals(makeWeek(), halfLogged(), [
      extra({ kind: "run", durationMin: 40, distanceMiles: 5 }),
    ]);
    expect(s.actualCardioMinutes).toBe(base.actualCardioMinutes + 40);
    expect(s.actualMileage).toBeCloseTo(base.actualMileage + 5, 1);
  });

  it("keeps a bike ride out of running mileage and a lift out of cardio time", () => {
    const base = computeWeekSignals(makeWeek(), halfLogged());
    const s = computeWeekSignals(makeWeek(), halfLogged(), [
      extra({ kind: "cardio", durationMin: 90, distanceMiles: 20 }),
      extra({ kind: "lift", durationMin: 60 }),
    ]);
    expect(s.actualCardioMinutes).toBe(base.actualCardioMinutes + 90);
    expect(s.actualMileage).toBeCloseTo(base.actualMileage, 1);
  });
});

// ============================================================
// Strain + session-RPE load
// ============================================================

describe("strain and load count extras", () => {
  it("pulls the strain average toward a hard extra", () => {
    const base = computeWeekSignals(makeWeek(), halfLogged());
    const s = computeWeekSignals(makeWeek(), halfLogged(), [
      extra({ kind: "run", durationMin: 45, distanceMiles: 5, rpe: 9 }),
    ]);
    expect(base.strain).not.toBeNull();
    expect(s.strain!).toBeGreaterThan(base.strain!);
  });

  it("weights an EASY extra 1.5×, exactly as it weights an easy session", () => {
    const hard = computeWeekSignals(makeWeek(), halfLogged(), [
      extra({ kind: "run", durationMin: 45, rpe: 8, goalZone: 4 }),
    ]);
    const easy = computeWeekSignals(makeWeek(), halfLogged(), [
      extra({ kind: "run", durationMin: 45, rpe: 8, goalZone: 2 }),
    ]);
    // Same RPE, more weight on it: an 8 logged against EASY work is the
    // strongest overreach signal there is.
    expect(easy.strain!).toBeGreaterThan(hard.strain!);
  });

  it("does not treat a zone-less extra as easy — no zone is no claim", () => {
    const noZone = computeWeekSignals(makeWeek(), halfLogged(), [
      extra({ kind: "run", durationMin: 45, rpe: 8 }),
    ]);
    const z4 = computeWeekSignals(makeWeek(), halfLogged(), [
      extra({ kind: "run", durationMin: 45, rpe: 8, goalZone: 4 }),
    ]);
    expect(noZone.strain).toBe(z4.strain);
  });

  it("adds rpe × minutes to the weekly load", () => {
    const base = computeWeekSignals(makeWeek(), halfLogged());
    const s = computeWeekSignals(makeWeek(), halfLogged(), [
      extra({ kind: "run", durationMin: 50, rpe: 6 }),
    ]);
    expect(s.weeklyLoad).toBe(base.weeklyLoad + 300);
  });

  it("falls back to the same defaults the planned side uses when no duration was recorded", () => {
    const base = computeWeekSignals(makeWeek(), halfLogged()).weeklyLoad;
    const hybrid = computeWeekSignals(makeWeek(), halfLogged(), [
      extra({ kind: "hybrid", rpe: 7 }),
    ]);
    const lift = computeWeekSignals(makeWeek(), halfLogged(), [extra({ kind: "lift", rpe: 7 })]);
    expect(hybrid.weeklyLoad).toBe(base + 7 * ADAPT.DEFAULT_HYBRID_MINUTES);
    expect(lift.weeklyLoad).toBe(base + 7 * 60); // STRENGTH_SESSION_MIN
  });

  it("counts an unmeasurable extra for credit but not for load", () => {
    const base = computeWeekSignals(makeWeek(), halfLogged());
    const s = computeWeekSignals(makeWeek(), halfLogged(), [extra({ kind: "other", rpe: 6 })]);
    // No duration and no default worth inventing → no honest load number.
    expect(s.weeklyLoad).toBe(base.weeklyLoad);
    // It still happened, though.
    expect(s.compliance).toBeGreaterThan(base.compliance);
  });

  it("contributes no load at all without an RPE", () => {
    const base = computeWeekSignals(makeWeek(), halfLogged());
    const s = computeWeekSignals(makeWeek(), halfLogged(), [
      extra({ kind: "run", durationMin: 50 }),
    ]);
    expect(s.weeklyLoad).toBe(base.weeklyLoad);
    expect(s.strain).toBe(base.strain);
  });

  it("lands an extra on its OWN day, so monotony still measures day-to-day spread", () => {
    // Same total load either way; the difference is how evenly it is spread.
    const onEmptySunday = computeWeekSignals(makeWeek(), halfLogged(), [
      extra({ day: "sun", kind: "run", durationMin: 50, rpe: 6 }),
    ]);
    const stackedOnMonday = computeWeekSignals(makeWeek(), halfLogged(), [
      extra({ day: "mon", kind: "run", durationMin: 50, rpe: 6 }),
    ]);
    expect(onEmptySunday.weeklyLoad).toBe(stackedOnMonday.weeklyLoad);
    expect(onEmptySunday.monotony).not.toBe(stackedOnMonday.monotony);
  });
});

// ============================================================
// ACWR — the reason the change exists
// ============================================================

describe("ACWR sees a spike built out of extras", () => {
  const weeks = [2, 3, 4, 5].map((n) => makeWeek(n));
  const steadyLogs: WorkoutLog[] = [2, 3, 4, 5].flatMap((n) => [
    log("mon", 0, "completed", 5, n),
    log("tue", 0, "completed", 5, n),
    log("wed", 0, "completed", 5, n),
    log("thu", 0, "completed", 5, n),
    log("fri", 0, "completed", 5, n),
    log("sat", 0, "completed", 5, n),
  ]);

  it("is flat when every week is the same — the control", () => {
    const { acwr } = computeLoadMetrics(weeks, steadyLogs, 5);
    expect(acwr).toBeCloseTo(1, 1);
  });

  it("spikes when the athlete piles unplanned work onto the reviewed week", () => {
    const extras = Array.from({ length: 5 }, (_, i) =>
      extra({ weekNumber: 5, day: "sun", kind: "run", durationMin: 60, rpe: 8, id: `spike${i}` }),
    );
    const { acwr } = computeLoadMetrics(weeks, steadyLogs, 5, extras);
    expect(acwr).not.toBeNull();
    expect(acwr!).toBeGreaterThanOrEqual(ADAPT.ACWR_SPIKE);
  });

  it("does not spike when the extra work was there all along", () => {
    // Extras across the WHOLE window raise the chronic baseline too. This is why
    // the loader reads the full ACWR window and not just the reviewed week —
    // otherwise a consistent extra habit would read as a spike every single week.
    const extras = [2, 3, 4, 5].flatMap((n) =>
      Array.from({ length: 5 }, (_, i) =>
        extra({
          weekNumber: n,
          day: "sun",
          kind: "run",
          durationMin: 60,
          rpe: 8,
          id: `w${n}-${i}`,
        }),
      ),
    );
    const { acwr } = computeLoadMetrics(weeks, steadyLogs, 5, extras);
    expect(acwr).toBeCloseTo(1, 1);
  });
});

// ============================================================
// Rules
// ============================================================

describe("the rules react to extras", () => {
  it("rescues a week from a hold when the athlete trained off-plan instead", () => {
    const week = makeWeek();
    // 3 of 6 prescribed sessions — a hold, on the plan alone.
    expect(decideAdaptation(computeWeekSignals(week, halfLogged()), makeCtx()).rule).toBe("hold");

    // The same week, plus two workouts the athlete chose for themselves.
    const withExtras = computeWeekSignals(week, halfLogged(), [
      extra({ kind: "run", durationMin: 45, distanceMiles: 5, rpe: 5 }),
      extra({ kind: "lift", durationMin: 50, rpe: 5 }),
    ]);
    const decision = decideAdaptation(withExtras, makeCtx());
    expect(decision.rule).toBe("none");
    // …and the review screen says where the number came from.
    expect(decision.reason).toContain("2 extra workouts you logged");
  });

  it("still protects the long run — an extra run is not THE long run", () => {
    const week = makeWeek();
    const logs = [
      log("mon", 0, "completed"),
      log("tue", 0, "completed"),
      log("wed", 0, "completed"),
      log("thu", 0, "completed"),
      log("fri", 0, "completed"),
      log("sat", 0, "skipped", null), // the long run
    ];
    const signals = computeWeekSignals(week, logs, [
      extra({ kind: "run", day: "sun", durationMin: 60, distanceMiles: 7, rpe: 5 }),
    ]);
    const decision = decideAdaptation(signals, makeCtx());
    expect(decision.rule).toBe("protect_long_run");
    expect(decision.constraints.longRunMaxMiles).toBe(10);
  });

  it("withholds the earned bump when the extras spiked the load", () => {
    const week = makeWeek();
    const perfect = [
      log("mon", 0, "completed", 3),
      log("tue", 0, "completed", 3),
      log("wed", 0, "completed", 3),
      log("thu", 0, "completed", 3),
      log("fri", 0, "completed", 3),
      log("sat", 0, "completed", 3),
    ];
    // Clean, compliant, easy week → the bump is earned.
    expect(decideAdaptation(computeWeekSignals(week, perfect), makeCtx({ acwr: 1.0 })).rule).toBe(
      "earned_bump",
    );
    // The same week with a load spike the athlete built themselves.
    expect(
      decideAdaptation(computeWeekSignals(week, perfect), makeCtx({ acwr: ADAPT.ACWR_SPIKE })).rule,
    ).toBe("load_spike");
  });
});
