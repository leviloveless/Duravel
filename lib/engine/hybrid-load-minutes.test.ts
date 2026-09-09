/**
 * Session-RPE load times a hybrid by its own clock, not by a flat 45 minutes
 * (Levi, 2026-09-09).
 *
 * `sessionLoadMinutes` in `adapt.ts` returned `ADAPT.DEFAULT_HYBRID_MINUTES` for
 * every hybrid session while delegating to `sessionTiming` for every other kind.
 * For the ordinary 8-element hybrid that was nearly right — those time out at
 * 40–46 minutes across the whole generated corpus. For the **race simulation**
 * in the peak block, which is 16 elements and times out at **86 minutes**, it
 * charged 45: a shade over half the load of the hardest session in the program,
 * in the two weeks before the taper.
 *
 * ## Why this one reaches the engine and the 2026-08-22 one did not
 *
 * `adapt-volume-total.test.ts` documents a bigger-looking error (a perfect week
 * reading 219% of its mileage) that changed no decision, because
 * `decideAdaptation` never read `plannedMileage`. It DOES read `ctx.acwr`, in
 * three places: `load_spike` (≥ 1.5 → early deload), `load_caution` (≥ 1.3 into
 * an increase week → hold), and the `earned_bump` gate. `ctx.acwr` is built by
 * `computeLoadMetrics` out of `weekLoad`, which is `computeWeekSignals(...)
 * .weeklyLoad`, which is Σ (rpe × `sessionLoadMinutes`). So the flat 45 was
 * prescribing, not just reporting — and `lib/generation/adapt-week.ts` wires
 * exactly that context into the live `/api/adapt/preview` and `/api/adapt/apply`
 * routes.
 *
 * Measured: on a fully-compliant, smoothly-progressing program ACWR moves by a
 * mean of 0.018 and crossed a threshold in 1 of 672 weeks — a ratio largely
 * cancels an error present in both halves. Across 768 scenarios where the acute
 * week is measured against partly-missed baseline weeks (the only shape that
 * pushes ACWR past 1.3 at all) the applied rule changed in 51, 36 of which were
 * the peak simulation week.
 *
 * The first test is the unit pin and the second is the delegation pin — two
 * surfaces showing the same number, one asking the other. Both fail on `main`:
 * the load minutes come back 45 there, not 86.
 */
import { describe, it, expect } from "vitest";
import type { ProgramWeek, Session, WorkoutLog } from "@/lib/schemas";
import { computeWeekSignals } from "./adapt";
import { ADAPT } from "./adapt-config";
import { sessionTiming } from "@/lib/session-volume";

/** A HYROX race simulation as `assembleProgram` stamps one in the peak block:
 *  8 runs + 8 stations, with the engine's pace-aware `workMin` on it. */
function simulation(workMin: number | undefined): Session {
  const elements = Array.from({ length: 16 }, (_, i) =>
    i % 2 === 0
      ? { exercise: "Run", prescription: "1000m", notes: null }
      : { exercise: "Sled Push", prescription: "50m", notes: null },
  );
  return {
    kind: "hybrid",
    title: "HYROX simulation",
    goalZone: 4,
    elements,
    ...(workMin === undefined ? {} : { workMin }),
  } as unknown as Session;
}

function weekWith(session: Session): ProgramWeek {
  return {
    weekNumber: 13,
    phase: "peak",
    microWeek: "rebound",
    summary: {
      totalCardioMinutes: 0,
      totalMileage: 0,
      zoneDistribution: { z1: 25, z2: 60, z3: 8, z4: 4, z5: 3 },
    },
    days: [{ day: "sat", sessions: [session] }],
  } as unknown as ProgramWeek;
}

const log = (rpe: number, durationMin?: number): WorkoutLog => ({
  weekNumber: 13,
  day: "sat",
  sessionIndex: 0,
  status: "completed",
  rpe,
  actuals: durationMin === undefined ? null : ({ durationMin } as never),
  note: null,
});

describe("a hybrid contributes its real duration to session-RPE load", () => {
  it("charges the peak race simulation its 86 minutes, not a flat 45", () => {
    const s = simulation(71); // the engine's own estimate for 8 km + 8 stations
    expect(sessionTiming(s).total).toBe(86); // 10 warm-up + 71 work + 5 cool-down

    const load = computeWeekSignals(weekWith(s), [log(8)]).weeklyLoad;
    expect(load).toBe(8 * 86);
    // The flat fallback would have charged little more than half of it.
    expect(load).toBeGreaterThan(8 * ADAPT.DEFAULT_HYBRID_MINUTES * 1.9);
  });

  it("delegates to sessionTiming rather than re-deriving the number", () => {
    // Whatever the session's timing says, the load says the same — including the
    // ordinary 8-element hybrid, where the old flat 45 happened to be close.
    for (const workMin of [26, 30, 45, 71, 110]) {
      const s = simulation(workMin);
      const load = computeWeekSignals(weekWith(s), [log(6)]).weeklyLoad;
      expect(load).toBe(6 * sessionTiming(s).total);
    }
  });

  it("still lets the athlete's own logged duration win", () => {
    const s = simulation(71);
    expect(computeWeekSignals(weekWith(s), [log(8, 95)]).weeklyLoad).toBe(8 * 95);
  });

  it("reads sensibly for a legacy hybrid carrying no workMin", () => {
    // Programs generated before `workMin` existed have none. `sessionTiming`'s
    // element-count proxy answers for them, so the session is worth a plausible
    // hour and a half of a hard simulation — never zero, and never a bare 45.
    const legacy = simulation(undefined);
    const total = sessionTiming(legacy).total;
    expect(total).toBe(95); // 10 + (16 elements × 5) + 5
    expect(computeWeekSignals(weekWith(legacy), [log(7)]).weeklyLoad).toBe(7 * total);
  });
});
