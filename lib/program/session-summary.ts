/**
 * Per-workout share artifacts: the result-card seed AND a Strava-ready
 * description, both derived from one place (Levi, 2026-08-04).
 *
 * The ask: every workout, in the app and on the website, should produce a card
 * photo and a description the athlete can put on Strava. Two gaps stood in the
 * way — the Share launcher only rendered on a COMPLETED workout, and a per-workout
 * description did not exist at all (`branding.ts` only ever appended a one-line
 * tag, never a summary of the session).
 *
 * Design decisions, all Levi's:
 *   - CONTENT: the plan, swapping to ACTUALS once the workout is logged or a
 *     Strava activity is linked. So this works before the session as a plan and
 *     after it as a record.
 *   - TEXT: engine-generated and deterministic. Free, instant, unit-testable, and
 *     it regenerates identically on a recalculate — no stored blob to go stale.
 *   - The `brandTagLine()` footer stays last so `stripBrandTag` can still find and
 *     replace the whole Duravel block; re-writing the same activity never stacks.
 *
 * PURE — no React, no network, no `Date.now()`. `lib/session-labels.ts` is shared
 * with the program table so the words on Strava match the words in the app.
 */

import type { Session, WorkoutLog } from "@/lib/schemas";
import { sessionTiming, sessionMiles } from "@/lib/session-volume";
import { sessionTypeLabel, patternLabel } from "@/lib/session-labels";
import type { BrandContext } from "@/lib/wearables/branding";

/** The result-card "session" seed shape (kept structural so `lib` needn't import UI). */
export interface SessionCardSeed {
  type: "session";
  athlete: string;
  sessType: string;
  sessMain: string;
  sessVol: string;
  sessTime: string;
  sessHr: string;
  coachNote: string;
}

export interface SessionSummaryContext extends BrandContext {
  /** Name on the card. */
  athlete?: string;
  /** The athlete's log, when there is one — actuals replace the planned numbers. */
  log?: WorkoutLog | null;
  /** Calendar day key ("mon"…"sun") — the middle field of the Strava title. */
  dayKey?: string | null;
}

export interface SessionSummary {
  /** Headline, e.g. "Threshold run — 2.5 mi". Used on the card. */
  title: string;
  /** Strava activity NAME, e.g. "Week 1 - Monday - Interval Run". */
  stravaTitle: string;
  /** Seed for the existing 1080px card renderer. */
  cardData: SessionCardSeed;
  /** Multi-line text ready to paste (or write) into a Strava activity. */
  stravaDescription: string;
}

function fmtMiles(m: number): string {
  return Number.isInteger(m) ? `${m} mi` : `${m.toFixed(1)} mi`;
}

/** Actuals the athlete logged, if any are usable. */
function actualsOf(log: WorkoutLog | null | undefined) {
  const a = log?.actuals;
  if (!a) return null;
  const has =
    typeof a.distanceMiles === "number" ||
    typeof a.durationMin === "number" ||
    typeof a.avgHr === "number";
  return has ? a : null;
}

/** One-line "what this session is", used on the card. */
export function sessionMainSet(session: Session): string {
  switch (session.kind) {
    case "run": {
      const dist = fmtMiles(sessionMiles(session));
      return session.paceMinMile ? `${dist} @ ${session.paceMinMile}/mi` : dist;
    }
    case "lift": {
      const names = session.movements.map((m) => m.exercise ?? patternLabel(m.pattern));
      return names.slice(0, 3).join(" · ") || "Full-body strength";
    }
    case "hybrid":
      return `${session.elements.length} stations`;
    case "swim":
    case "bike":
      return `${Math.round(session.durationMin)} min ${session.sessionType.replace(/_/g, " ")}`;
    case "brick":
      return "Bike → run brick";
    case "cardio":
      return `${Math.round(session.durationMin)} min ${session.modality ?? "cardio"}`;
    case "race":
      return `${session.priority} race`;
    default:
      return "";
  }
}

/**
 * The prescription, as lines. This is the part that makes the description worth
 * pasting: what to actually do, not just a label.
 *
 * Runs already carry an engine-written how-to (warmup / work / cooldown / ratio)
 * whose rep count is derived from the run's real distance, so it is quoted
 * verbatim — that is exactly the text Levi asked to see on Strava. Lifts, hybrids
 * and the triathlon disciplines are built here.
 */
function prescriptionLines(session: Session): string[] {
  switch (session.kind) {
    case "run": {
      if (session.description) return session.description.split("\n").filter(Boolean);
      return [`${fmtMiles(sessionMiles(session))} @ ${session.paceMinMile}/mi`];
    }
    case "lift": {
      const lines = session.movements.map((m) => {
        const name = m.exercise ?? patternLabel(m.pattern);
        const reps = m.repRange.replace(/-/g, "\u2013");
        const load = m.suggestedWeight ? ` \u2014 ${m.suggestedWeight}` : "";
        return `${name} \u2014 ${m.sets} x ${reps}${load}`;
      });
      if (session.power) {
        lines.push(
          `Plyometrics: ${session.power.exercise} \u2014 ${session.power.sets} x ${session.power.reps}`,
        );
      }
      return lines;
    }
    case "hybrid":
      // Warm-up first, cooldown last — the jog is prescribed work and is counted
      // in the week's mileage, so the Strava description states it too.
      return [
        ...(session.warmup ? [session.warmup] : []),
        ...session.elements.map((el) => `${el.exercise} \u2014 ${el.prescription}`),
        ...(session.cooldown ? [session.cooldown] : []),
      ];
    case "brick":
      return session.segments.map(
        (seg) =>
          `${seg.discipline} \u2014 ${Math.round(seg.durationMin)} min, Zone ${seg.goalZone}`,
      );
    case "swim":
    case "bike":
      return [
        `${Math.round(session.durationMin)} min ${session.sessionType.replace(/_/g, " ")}, Zone ${session.goalZone}`,
      ];
    case "cardio":
      return [
        `${Math.round(session.durationMin)} min ${session.modality ?? "Zone 1\u20132 cardio"}, Zone ${session.goalZone}`,
      ];
    default:
      return [];
  }
}

const DAY_NAME: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** "Interval run" -> "Interval Run". Strava titles read as titles. */
function titleCase(label: string): string {
  return label.replace(/\S+/g, (w) => (w.length > 2 ? w[0]!.toUpperCase() + w.slice(1) : w));
}

/**
 * `Week 1 - Monday - Interval Run` (Levi, 2026-08-05).
 *
 * Every field is dropped gracefully when missing — a session with no week number
 * or day still yields a sensible title rather than "Week undefined - ".
 */
export function stravaTitleLine(
  dayKey: string | null | undefined,
  weekNumber: number | null | undefined,
  label: string,
): string {
  const parts: string[] = [];
  if (typeof weekNumber === "number" && weekNumber > 0) parts.push(`Week ${weekNumber}`);
  const day = dayKey ? DAY_NAME[dayKey.toLowerCase()] : undefined;
  if (day) parts.push(day);
  parts.push(titleCase(label));
  return parts.join(" - ");
}

/**
 * Build both share artifacts for one session.
 *
 * Works on ANY session — planned, logged, or linked — which is the point: the
 * old path could only produce a card for a workout already marked complete.
 */
export function sessionSummary(session: Session, ctx: SessionSummaryContext = {}): SessionSummary {
  const label = sessionTypeLabel(session);
  const a = actualsOf(ctx.log);

  const headlineMiles =
    typeof a?.distanceMiles === "number"
      ? a.distanceMiles
      : session.kind === "run"
        ? sessionMiles(session)
        : 0;
  const title = headlineMiles > 0 ? `${label} — ${fmtMiles(headlineMiles)}` : label;

  // --- card seed (actuals win, planned is the fallback) ---
  const sessVol = headlineMiles > 0 ? fmtMiles(headlineMiles) : "—";
  const timeMin =
    typeof a?.durationMin === "number" ? Math.round(a.durationMin) : sessionTiming(session).total;
  const sessHr = typeof a?.avgHr === "number" ? `Avg ${Math.round(a.avgHr)} bpm` : "";
  const note = ctx.log?.note?.trim();
  // A workout marked complete gets the completed note even if the athlete never
  // filled in distance/duration/HR — seen live: a session showing "Done · RPE 3"
  // carried the not-started note because `actuals` was empty.
  const done = ctx.log?.status === "completed" || !!a;
  const coachNote = note && note.length > 0 ? note : defaultNote(session, done);

  const cardData: SessionCardSeed = {
    type: "session",
    athlete: ctx.athlete ?? "",
    sessType: label,
    sessMain: sessionMainSet(session),
    sessVol,
    sessTime: timeMin > 0 ? `${timeMin} min` : "—",
    sessHr,
    coachNote,
  };

  // --- Strava title + description (Levi, 2026-08-05) ---
  //
  // The exact shape Levi asked for:
  //
  //     Week 1 - Monday - Interval Run
  //     Warm up: 15 min easy (~1.1 mi) @ 13:20/mi with 3-4 short strides
  //     Work: 4 x 1km at 7:40/mi ...
  //     Cooldown: 10 min easy (~0.8 mi) @ 13:20/mi
  //
  // The title is the Strava activity NAME; the description is the workout
  // prescription verbatim and nothing else. No "Planned/Actual" block and no
  // Duravel footer — the athlete asked for the workout, so the workout is what
  // goes on. `stravaTitleLine` doubles as the idempotency anchor (see
  // `replaceWorkoutBlock` in lib/wearables/branding.ts): a re-write finds the
  // previous title line and replaces from there, so re-syncing never stacks.
  const stravaTitle = stravaTitleLine(ctx.dayKey, ctx.weekNumber, label);
  const stravaDescription = [stravaTitle, ...prescriptionLines(session)].join("\n");

  return { title, stravaTitle, cardData, stravaDescription };
}

function defaultNote(session: Session, logged: boolean): string {
  if (logged) return "Logged and done. On to the next one.";
  if (session.kind === "lift") return "Earn it.";
  if (session.kind === "hybrid") return "Compromised running. This is the one that counts.";
  return "On the plan. Let's go.";
}
