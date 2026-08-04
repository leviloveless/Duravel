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
import { brandTagLine, BRAND_MARKER, type BrandContext } from "@/lib/wearables/branding";

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
}

export interface SessionSummary {
  /** Headline, e.g. "Threshold run — 2.5 mi". */
  title: string;
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
 * verbatim. Lifts, hybrids and the triathlon disciplines are built here.
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
        const reps = m.repRange.replace(/-/g, "–");
        const load = m.suggestedWeight ? ` — ${m.suggestedWeight}` : "";
        return `${name} — ${m.sets} x ${reps}${load}`;
      });
      if (session.power) {
        lines.push(
          `Plyometrics: ${session.power.exercise} — ${session.power.sets} x ${session.power.reps}`,
        );
      }
      return lines;
    }
    case "hybrid":
      return session.elements.map((el) => `${el.exercise} — ${el.prescription}`);
    case "brick":
      return session.segments.map(
        (seg) => `${seg.discipline} — ${Math.round(seg.durationMin)} min, Zone ${seg.goalZone}`,
      );
    case "swim":
    case "bike":
      return [
        `${Math.round(session.durationMin)} min ${session.sessionType.replace(/_/g, " ")}, Zone ${session.goalZone}`,
      ];
    case "cardio":
      return [
        `${Math.round(session.durationMin)} min ${session.modality ?? "Zone 1–2 cardio"}, Zone ${session.goalZone}`,
      ];
    default:
      return [];
  }
}

/** "2.5 mi · 28 min · Zone 4" — whichever of those the session actually has. */
function plannedLine(session: Session): string {
  const parts: string[] = [];
  const miles = session.kind === "run" ? sessionMiles(session) : 0;
  if (miles > 0) parts.push(fmtMiles(miles));
  const total = sessionTiming(session).total;
  if (total > 0) parts.push(`${total} min`);
  if ("goalZone" in session && session.goalZone) parts.push(`Zone ${session.goalZone}`);
  return parts.join(" · ");
}

function actualLine(log: WorkoutLog | null | undefined): string | null {
  const a = actualsOf(log);
  if (!a) return null;
  const parts: string[] = [];
  if (typeof a.distanceMiles === "number") parts.push(fmtMiles(a.distanceMiles));
  if (typeof a.durationMin === "number") parts.push(`${Math.round(a.durationMin)} min`);
  if (typeof a.avgHr === "number") parts.push(`avg ${Math.round(a.avgHr)} bpm`);
  if (typeof log?.rpe === "number") parts.push(`RPE ${log.rpe}`);
  return parts.length ? parts.join(" · ") : null;
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

  // --- Strava description ---
  //
  // The block OPENS with a line starting `BRAND_MARKER`. That is deliberate and
  // load-bearing: `stripBrandTag` removes everything from the first marker to the
  // end, so opening with it makes the whole block — body included — replaceable.
  // Without it, a re-write would strip only the footer tag and append the body a
  // second time, stacking the workout text on every sync.
  const blocks: string[] = [`${BRAND_MARKER} · ${title}`];

  const pres = prescriptionLines(session);
  if (pres.length) blocks.push(pres.join("\n"));

  const planned = plannedLine(session);
  const actual = actualLine(ctx.log);
  const stats: string[] = [];
  if (planned) stats.push(`Planned: ${planned}`);
  if (actual) stats.push(`Actual: ${actual}`);
  if (stats.length) blocks.push(stats.join("\n"));

  // The Duravel tag stays LAST so `stripBrandTag` can replace the whole block on
  // a re-write. Never insert anything after it.
  blocks.push(
    brandTagLine({
      programName: ctx.programName,
      weekNumber: ctx.weekNumber,
      sessionLabel: ctx.sessionLabel ?? label,
    }),
  );

  return { title, cardData, stravaDescription: blocks.join("\n\n") };
}

function defaultNote(session: Session, logged: boolean): string {
  if (logged) return "Logged and done. On to the next one.";
  if (session.kind === "lift") return "Earn it.";
  if (session.kind === "hybrid") return "Compromised running. This is the one that counts.";
  return "On the plan. Let's go.";
}
