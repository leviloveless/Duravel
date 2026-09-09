/**
 * A hand-edited week and its skeleton must agree (Levi, 2026-09-08).
 *
 * The failure this guards is quiet, which is why it survived: `saveCoachSession`
 * edits `program_data` and recomputes the week summary, and leaves the stored
 * `skeleton` on whatever the engine last built. Both are read, by different
 * things — the athlete sees the program, `adapt-week.ts` plans next week from
 * the skeleton — so after an edit an adaptation can be built around a session
 * that is no longer on the calendar, and nothing anywhere reports a problem.
 *
 * Admin-only, it was survivable. In front of a paying athlete it is not.
 */
import { describe, it, expect } from "vitest";
import { syncSkeletonWeek, syncSkeleton } from "./skeleton-sync";
import type { ProgramData } from "@/lib/schemas";
import type { ProgramSkeleton } from "@/lib/engine/types";

const skeleton: ProgramSkeleton = {
  durationWeeks: 2,
  trainingClass: "non_highly_trained",
  allocation: { base: 1, build: 1, peak: 0, taper: 0 },
  weeks: [
    {
      weekNumber: 1,
      phase: "base",
      microWeek: "increase",
      targetMileage: 20,
      targetCardioMinutes: 300,
      zoneTargets: { z1: 25, z2: 60, z3: 8, z4: 4, z5: 3 },
      days: [
        { day: "mon", sessions: [{ kind: "run", runType: "easy", goalZone: 2 }] },
        { day: "sat", sessions: [{ kind: "run", runType: "long", goalZone: 2, isLong: true }] },
      ],
    },
    {
      weekNumber: 2,
      phase: "build",
      microWeek: "increase",
      targetMileage: 22,
      targetCardioMinutes: 320,
      zoneTargets: { z1: 25, z2: 60, z3: 8, z4: 4, z5: 3 },
      days: [{ day: "mon", sessions: [{ kind: "lift", liftType: "full" }] }],
    },
  ],
};

const run = (runType: string, miles: number) => ({
  kind: "run" as const,
  runType: runType as "easy",
  distanceMiles: miles,
  durationMin: miles * 10,
  paceMinMile: "10:00",
  goalZone: 2,
});

/** Week 1's easy run has been swapped for a threshold run by hand. */
const program = {
  weeks: [
    {
      weekNumber: 1,
      phase: "base",
      microWeek: "increase",
      summary: {
        totalMileage: 24,
        totalCardioMinutes: 340,
        zoneDistribution: { z1: 25, z2: 60, z3: 8, z4: 4, z5: 3 },
      },
      days: [
        { day: "mon", sessions: [run("threshold", 5)] },
        { day: "tue", sessions: [] },
        { day: "sat", sessions: [run("long", 8)] },
      ],
    },
  ],
} as unknown as ProgramData;

describe("syncSkeletonWeek", () => {
  const synced = syncSkeletonWeek(skeleton, program, 1);
  const w1 = synced.weeks.find((w) => w.weekNumber === 1)!;

  it("makes the skeleton's slots match the sessions the athlete can see", () => {
    const mon = w1.days.find((d) => d.day === "mon")!;
    expect(mon.sessions).toEqual([{ kind: "run", runType: "threshold", goalZone: 2 }]);
  });

  it("marks the long run as long, so the jump ceiling still finds it", () => {
    const sat = w1.days.find((d) => d.day === "sat")!;
    expect(sat.sessions[0]).toMatchObject({ kind: "run", runType: "long", isLong: true });
  });

  it("gives an emptied day a rest slot rather than an empty one", () => {
    const tue = w1.days.find((d) => d.day === "tue")!;
    expect(tue.sessions).toEqual([{ kind: "rest" }]);
  });

  it("takes the week's volume from the edited week", () => {
    expect(w1.targetMileage).toBe(24);
    expect(w1.targetCardioMinutes).toBe(340);
  });

  it("does not touch phase, microcycle or zone targets — those are not a hand edit's to move", () => {
    expect(w1.phase).toBe("base");
    expect(w1.microWeek).toBe("increase");
    expect(w1.zoneTargets).toEqual(skeleton.weeks[0]!.zoneTargets);
  });

  it("leaves every other week alone", () => {
    expect(JSON.stringify(synced.weeks.find((w) => w.weekNumber === 2))).toBe(
      JSON.stringify(skeleton.weeks[1]),
    );
  });

  it("is a no-op for a week the program does not have", () => {
    expect(JSON.stringify(syncSkeletonWeek(skeleton, program, 99))).toBe(JSON.stringify(skeleton));
  });
});

describe("syncSkeleton", () => {
  it("syncs every week the program carries", () => {
    const synced = syncSkeleton(skeleton, program);
    expect(synced.weeks.find((w) => w.weekNumber === 1)!.targetMileage).toBe(24);
    // Week 2 is not in the program blob, so it is untouched rather than dropped.
    expect(synced.weeks.find((w) => w.weekNumber === 2)!.targetMileage).toBe(22);
  });
});

describe("a Zone 1–2 filler block has no slot", () => {
  it("is dropped rather than invented into the skeleton", () => {
    // The reconciler emits cardio blocks AFTER slot assignment to fill the week's
    // cardio target. They were never engine choices, so putting them back into the
    // skeleton would have the next adaptation plan around a session the engine
    // did not pick.
    const withCardio = {
      weeks: [
        {
          ...program.weeks[0]!,
          days: [
            {
              day: "mon",
              sessions: [
                run("easy", 4),
                { kind: "cardio", modality: "bike", durationMin: 45, goalZone: 2 },
              ],
            },
          ],
        },
      ],
    } as unknown as ProgramData;
    const mon = syncSkeletonWeek(skeleton, withCardio, 1).weeks[0]!.days.find(
      (d) => d.day === "mon",
    )!;
    expect(mon.sessions).toHaveLength(1);
    expect(mon.sessions[0]).toMatchObject({ kind: "run" });
  });
});
