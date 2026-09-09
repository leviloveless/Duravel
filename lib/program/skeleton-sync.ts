/**
 * Keep a program's stored SKELETON in step with its edited weeks.
 *
 * ## The bug this exists to close
 *
 * `saveCoachSession` and `updateProgramData` edit `program_data` and recompute
 * the week's summary, and that is all they do. The `skeleton` column is left on
 * whatever the engine last built, so after any hand edit the two disagree — and
 * they are both read, by different things:
 *
 *   - the athlete sees `program_data`;
 *   - `adapt-week.ts` builds next week's mini-skeleton from `skeleton.weeks`,
 *     so an adaptation is planned against sessions that are no longer there;
 *   - a Recalculate rebuilds from `input_snapshot` and discards the edit
 *     entirely, which is correct for a REGENERATE and indistinguishable from a
 *     bug to whoever made the edit.
 *
 * It has been survivable so far only because the editors are admin-only and we
 * know to expect it. The custom tier puts session editing in front of paying
 * athletes, and "your change quietly vanished" is not a thing to ship.
 *
 * ## What this does and does not fix
 *
 * It syncs the skeleton, so the adapt path and the athlete see the same week.
 * It does NOT make a hand edit survive a Recalculate — nothing can, because a
 * Recalculate is a rebuild from inputs by definition. The durable way to change
 * a program's shape is `weekTemplateChanges` on the input snapshot
 * (`amendWeekTemplate`), which IS an input and therefore does survive. A hand
 * edit is for one week; an amendment is for the plan.
 *
 * PURE — no I/O.
 */

import type { ProgramData, Session } from "@/lib/schemas";
import type { DaySlot, ProgramSkeleton, SessionSlot } from "@/lib/engine/types";

/**
 * The engine slot a generated session corresponds to.
 *
 * Returns null for kinds the SKELETON never carries. Zone 1–2 `cardio` blocks
 * are the important one: the reconciler emits them to fill a week's cardio
 * target after slot assignment, so they have no slot and inventing one would
 * make the next adaptation plan around a session the engine did not choose.
 *
 * A program day never holds a `rest` SESSION — an empty day is empty, and the
 * rest slot is added back by the caller.
 */
function slotFor(s: Session): SessionSlot | null {
  switch (s.kind) {
    case "run":
      return {
        kind: "run",
        runType: s.runType,
        goalZone: s.goalZone,
        ...(s.runType === "long" ? { isLong: true } : {}),
      };
    case "lift":
      return { kind: "lift", liftType: s.liftType };
    case "hybrid":
      return {
        kind: "hybrid",
        goalZone: s.goalZone,
        ...(s.simulation ? { simulation: true } : {}),
      };
    case "race":
      return { kind: "race", priority: s.priority };
    case "swim":
      return {
        kind: "swim",
        goalZone: s.goalZone,
        durationMin: s.durationMin,
        sessionType: s.sessionType,
      };
    case "bike":
      return {
        kind: "bike",
        goalZone: s.goalZone,
        durationMin: s.durationMin,
        ...(s.isLong ? { isLong: true } : {}),
        sessionType: s.sessionType,
      };
    case "brick":
      return { kind: "brick", goalZone: s.goalZone, segments: s.segments };
    default:
      return null;
  }
}

/** One program week's days, expressed as engine slots. */
function slotsForWeek(week: ProgramData["weeks"][number]): DaySlot[] {
  return week.days.map((d) => {
    const sessions = d.sessions.map(slotFor).filter((x): x is SessionSlot => x !== null);
    return { day: d.day, sessions: sessions.length > 0 ? sessions : [{ kind: "rest" }] };
  });
}

/**
 * A skeleton whose week `weekNumber` matches the edited program week.
 *
 * Returns the skeleton unchanged when there is no such week, so a caller can
 * apply this unconditionally. Only the day slots and the week's volume summary
 * move — phase, microcycle and zone targets are the periodization's and a hand
 * edit does not get to reach them.
 */
export function syncSkeletonWeek(
  skeleton: ProgramSkeleton,
  program: ProgramData,
  weekNumber: number,
): ProgramSkeleton {
  const programWeek = program.weeks.find((w) => w.weekNumber === weekNumber);
  if (!programWeek) return skeleton;
  return {
    ...skeleton,
    weeks: skeleton.weeks.map((w) =>
      w.weekNumber === weekNumber
        ? {
            ...w,
            days: slotsForWeek(programWeek),
            targetMileage: programWeek.summary.totalMileage,
            targetCardioMinutes: programWeek.summary.totalCardioMinutes,
          }
        : w,
    ),
  };
}

/** Every week synced at once — for a whole-program JSON edit. */
export function syncSkeleton(skeleton: ProgramSkeleton, program: ProgramData): ProgramSkeleton {
  return program.weeks.reduce((sk, w) => syncSkeletonWeek(sk, program, w.weekNumber), skeleton);
}
