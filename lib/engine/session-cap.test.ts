import { describe, it, expect } from "vitest";
import { planWeek, RUN_COUNT, HYBRID_COUNT, type SessionCountTables } from "./slots";
import { bandSessionCap, bandAnchorRunFloor } from "./time-budget";
import { bandCardioSlots } from "./caps";
import type { GenerationInput } from "@/lib/schemas";
import { buildSkeleton, toEngineInput } from "./skeleton";
import { assembleProgram } from "@/lib/generation/assemble";
import { sessionMiles, sessionTiming } from "@/lib/session-volume";

const START = "2026-09-07";

/**
 * Batch 4 (Finding 4): a band athlete's total weekly sessions are reconciled
 * against the hours budget so a 10 h athlete gets ~5–6 anchors, not 8–10
 * fragments. Trim comes off easy filler runs first, then surplus hybrids for
 * run-dominant sports; the research lift dose is never touched.
 */

// A HYROX-shaped table wired the way skeleton.ts wires it for a band athlete.
function bandTable(cap: number, floor: number, lift = 2): SessionCountTables {
  return {
    run: RUN_COUNT,
    hybrid: HYBRID_COUNT,
    lift: { base: lift, build: lift, peak: lift, taper: Math.max(1, lift - 1) },
    guaranteeQuality: true,
    researchLifts: true,
    runCharacter: "full",
    weeklySessionCap: cap,
    anchorRunFloor: floor,
  };
}

const total = (p: { runs: number; lifts: number; hybrids: number }) => p.runs + p.lifts + p.hybrids;

describe("session-count reconciliation", () => {
  it("caps a 10 h intermediate Build week from 10 sessions to the budget", () => {
    // Uncapped: 5 runs + 2 lifts + 2 hybrids = 9–10 fragments.
    const uncapped = planWeek("build", "increase", "intermediate", "intermediate", undefined, {
      run: RUN_COUNT,
      hybrid: HYBRID_COUNT,
      lift: { base: 2, build: 2, peak: 2, taper: 1 },
    });
    expect(total(uncapped)).toBeGreaterThanOrEqual(8);

    const capped = planWeek(
      "build",
      "increase",
      "intermediate",
      "intermediate",
      undefined,
      bandTable(6, 3),
    );
    expect(total(capped)).toBeLessThanOrEqual(6);
  });

  it("preserves the anchor run floor (long + threshold + VO2)", () => {
    const p = planWeek("build", "increase", "advanced", "advanced", undefined, bandTable(6, 3));
    expect(p.runs).toBeGreaterThanOrEqual(3); // never trims below the quality anchors
  });

  it("never trims the research lift dose", () => {
    const p = planWeek("build", "increase", "beginner", "beginner", undefined, bandTable(5, 2, 3));
    expect(p.lifts).toBe(3); // lifts are anchors, protected by the cap
  });

  it("at the lowest budget keeps only long + VO2 (floor 2)", () => {
    const p = planWeek("build", "increase", "beginner", "beginner", undefined, bandTable(5, 2, 1));
    expect(p.runs).toBeGreaterThanOrEqual(2);
  });

  it("does not touch un-capped (golden) tables", () => {
    const g = planWeek("build", "increase", "intermediate", "intermediate", undefined, {
      run: RUN_COUNT,
      hybrid: HYBRID_COUNT,
      lift: { base: 3, build: 3, peak: 3, taper: 2 },
    });
    expect(g.runs).toBe(RUN_COUNT.build[1]); // exactly the phase/exp count, no cap applied
  });

  it("band tables expose sane cap/floor values", () => {
    expect(bandSessionCap("h5_10")).toBe(6);
    expect(bandSessionCap("h30_40")).toBeGreaterThan(bandSessionCap("h0_5"));
    expect(bandAnchorRunFloor("h0_5")).toBe(2);
    expect(bandAnchorRunFloor("h10_20")).toBe(3);
  });
});

/**
 * THE HOURS NEED SOMEWHERE TO GO (Levi, 2026-09-09: *"as the hours available to
 * train goes up, the max session length needs to increase accordingly so that
 * this does not happen"*).
 *
 * What "this" was, measured on a HYROX `h20_30` advanced build across a full
 * 16-week program: weekly MILEAGE hit exactly, weekly CARDIO MINUTES delivered
 * at 54% of prescription — 1560 prescribed against 580 on the peak week. The
 * mechanism is entirely a slot-accounting one. `runsForMileage` buys mileage
 * with sessions rather than length, the buy-back below the session budget was
 * bounded only by `dayCapacity`, and a 56-mile week therefore asked for eight
 * runs. Eight runs + four lifts + one hybrid is 13 of the week's 14 slots (7
 * days x 2, and two-a-day is absolute), so the standalone Zone 1-2 work — which
 * is most of what a 26-hour aerobic week is made of — had a single slot left.
 *
 * These assertions are about the SLOT BUDGET, which is the half of the problem
 * this file owns. They fail on a tree without `cardioSlotReserve`: the h20_30
 * case returns 8 runs (13 sessions) instead of 6 (11).
 */
describe("Zone 1-2 slots survive the mileage run floor", () => {
  // A 7-day h20_30 HYROX peak week, wired the way skeleton.ts wires it: the
  // research lift dose (4), one hybrid, and the band's own session budget.
  const h20_30 = (reserve: number | undefined): SessionCountTables => ({
    ...bandTable(bandSessionCap("h20_30"), bandAnchorRunFloor("h20_30"), 4),
    dayCapacity: 14,
    cardioSlotReserve: reserve,
  });
  // The peak mileage an h20_30 build actually reaches. `runsForMileage` wants 8
  // runs for it — more than the whole session budget on its own.
  const PEAK_MILES = 56.7;

  it("leaves the band's reserved slots free at h20_30", () => {
    const p = planWeek(
      "peak",
      "increase",
      "advanced",
      "advanced",
      undefined,
      h20_30(3),
      PEAK_MILES,
    );
    expect(total(p)).toBe(11); // 6 runs + 4 lifts + 1 hybrid — three slots spare
    expect(14 - total(p)).toBe(bandCardioSlots("h20_30"));
  });

  it("without the reserve the mileage floor takes 13 of the 14 slots", () => {
    // The pre-fix behaviour, kept as the contrast: this is what shipped a week
    // with one slot for 980 minutes of Zone 1-2.
    const p = planWeek(
      "peak",
      "increase",
      "advanced",
      "advanced",
      undefined,
      h20_30(undefined),
      PEAK_MILES,
    );
    expect(total(p)).toBe(13);
  });

  it("delivers the band's cardio minutes end to end, without losing the mileage", () => {
    // The measurement that started this, run as a test. Deterministic: empty AI
    // chunks, so it is the engine and the reconciler alone.
    //
    // Peak week BEFORE: 1560 prescribed, 580 delivered (37%), mileage exact.
    // Peak week AFTER:  1560 prescribed, 904 delivered (58%), mileage exact.
    //
    // The floor is set at 850 rather than at the prescription because the rest
    // of the gap is not this file's to close — see the note below on
    // `weekCardioCapacity`. What it does pin is that the slots freed here are
    // actually SPENT: a tree without `cardioSlotReserve` delivers 580 and fails.
    const gen = {
      profile: {
        firstName: "L",
        age: 35,
        bodyWeight: 80,
        weightUnit: "kg",
        runningExp: "advanced",
        hybridExp: "advanced",
        liftingExp: "advanced",
        trainingClass: "non_highly_trained",
        trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        sex: "male",
        weeklyHours: "h20_30",
        benchmarks: { fiveKTime: "24:00" },
      },
      programType: "goal_event",
      durationWeeks: 16,
      races: [{ raceDate: "2026-12-26", priority: "A" }],
      startDate: START,
    } as unknown as GenerationInput;

    const skeleton = buildSkeleton(toEngineInput(gen, START));
    // ⚠️ `assembleProgram` writes the DELIVERED mileage back onto the skeleton
    // week, so the targets have to be read before it runs or the mileage check
    // below compares a number with itself.
    const target = new Map(
      skeleton.weeks.map((w) => [w.weekNumber, [w.targetMileage, w.targetCardioMinutes] as const]),
    );
    const { program } = assembleProgram(skeleton, [], "advanced", {
      fiveKTime: "24:00",
    } as never);

    let checked = 0;
    for (const week of program.weeks) {
      const [targetMi, targetCardio] = target.get(week.weekNumber)!;
      if (targetCardio < 1400) continue; // peak weeks only
      let cardio = 0;
      let miles = 0;
      for (const day of week.days)
        for (const s of day.sessions) {
          miles += sessionMiles(s);
          if (
            s.kind === "run" ||
            s.kind === "hybrid" ||
            s.kind === "brick" ||
            s.kind === "cardio" ||
            s.kind === "bike" ||
            s.kind === "swim"
          )
            cardio += sessionTiming(s).total;
        }
      expect(cardio).toBeGreaterThan(850);
      // ...and the target the engine already hit is not paid for it.
      expect(miles).toBeCloseTo(targetMi, 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("never cuts below the research session budget", () => {
    // A short week has no surplus slots to reserve. The budget is the shape the
    // band was designed around and the reserve is not allowed to eat into it.
    const short: SessionCountTables = {
      ...bandTable(bandSessionCap("h20_30"), bandAnchorRunFloor("h20_30"), 4),
      dayCapacity: 8, // a 4-day week
      cardioSlotReserve: 3,
    };
    const p = planWeek("peak", "increase", "advanced", "advanced", undefined, short, PEAK_MILES);
    expect(total(p)).toBe(bandSessionCap("h20_30"));
  });

  /**
   * WHAT IS STILL SHORT, AND WHY IT IS NOT A SLOT PROBLEM.
   *
   * After this change an h20_30 peak week delivers ~904 of 1560 prescribed
   * cardio minutes; h10_20 reaches ~92% of its own. The rest cannot be bought
   * with slots, and reserving more would cost the mileage target — see the
   * arithmetic in `BAND_CARDIO_SLOTS`.
   *
   * Two things in `lib/generation/reconcile.ts` own the remainder.
   *
   * 1. `weekCardioCapacity` is called BEFORE the runs are sized. A run that has
   *    not been sized yet reports zero minutes, so an occupied slot contributes
   *    nothing to the capacity figure and the prescription is clamped to
   *    (free slots x the Zone 1-2 ceiling) alone. Measured on the pre-change
   *    h20_30 peak week: capacity came out around 326 against runs that were
   *    about to total 580, which made the gap NEGATIVE — so the week not only
   *    added no Zone 1-2 block, it took the cross-training top-up back off its
   *    runs. Computing capacity on the sized week gives 927 for the same days.
   * 2. `stampCrossCardio` tops a run up to `MIN_CARDIO_TOTAL` (45 min) and no
   *    further. Levi's own description of a high-volume aerobic session — *"a
   *    one hour easy cardio workout might be 30 minutes on the bike and 30
   *    minutes running"* — is a run slot carrying Zone 1-2 beside the run, and
   *    that is the only way an already-full week grows without a 15th session.
   *    Ten aerobic slots averaging 132 minutes is 30 hours; ten averaging 90 is
   *    not, and no slot budget changes that.
   */

  it("leaves the low bands alone — they were already delivering in full", () => {
    // h0_5 and h5_10 hit their prescribed cardio EXACTLY (180/180, 360/360) with
    // slots to spare. A reserve there would take sessions off athletes who are
    // not short of anything.
    expect(bandCardioSlots("h0_5")).toBe(0);
    expect(bandCardioSlots("h5_10")).toBe(0);
    for (const band of ["h0_5", "h5_10"] as const) {
      const counts: SessionCountTables = {
        ...bandTable(bandSessionCap(band), bandAnchorRunFloor(band), 2),
        dayCapacity: 14,
        cardioSlotReserve: bandCardioSlots(band),
      };
      const withReserve = planWeek(
        "build",
        "increase",
        "intermediate",
        "intermediate",
        undefined,
        counts,
        20,
      );
      const without = planWeek(
        "build",
        "increase",
        "intermediate",
        "intermediate",
        undefined,
        { ...counts, cardioSlotReserve: undefined },
        20,
      );
      expect(total(withReserve)).toBe(total(without));
    }
  });
});
