import type { Session, WorkoutLog } from "@/lib/schemas";
import type { CardData } from "./result-card";
import { sessionTypeLabel, sessionPace, sessionTiming } from "./format";
import { sessionMiles } from "@/lib/session-volume";

/**
 * Map a completed session + its workout log into a "session" result-card seed
 * (Increment 2: auto-prefill a shareable card straight from a logged workout).
 *
 * Pulls the headline from the session (type + main prescription) and the stats
 * from the athlete's logged actuals, falling back to the planned numbers when an
 * actual wasn't entered. Everything stays editable in the studio afterward.
 */

type SessionCard = Extract<CardData, { type: "session" }>;

function fmtMiles(m: number): string {
  return Number.isInteger(m) ? `${m} mi` : `${m.toFixed(1)} mi`;
}

/** Short "main set" line describing what the session was. */
function mainSet(session: Session): string {
  switch (session.kind) {
    case "run": {
      const pace = sessionPace(session);
      const dist = fmtMiles(sessionMiles(session));
      return pace !== "—" ? `${dist} @ ${pace}` : dist;
    }
    case "lift":
      return (
        session.movements
          .map((m) => m.pattern)
          .slice(0, 3)
          .join(" · ") || "Full-body strength"
      );
    case "hybrid":
      return `${session.elements.length} stations`;
    case "swim":
    case "bike":
      return `${Math.round(session.durationMin)} min ${session.sessionType.replace(/_/g, " ")}`;
    case "brick":
      return "Bike → run brick";
    case "cardio":
      return `${Math.round(session.durationMin)} min ${session.modality ?? "cardio"}`;
    default:
      return "";
  }
}

export function sessionCardFromLog(
  session: Session,
  log: WorkoutLog,
  athlete: string,
): SessionCard {
  const a = log.actuals ?? {};

  // Volume: prefer the logged distance; else the planned run mileage (total
  // on-feet, matching the weekly figure).
  const plannedMiles = session.kind === "run" ? sessionMiles(session) : 0;
  const sessVol =
    typeof a.distanceMiles === "number"
      ? fmtMiles(a.distanceMiles)
      : plannedMiles > 0
        ? fmtMiles(plannedMiles)
        : "—";

  // Time: prefer the logged duration; else the planned session total.
  const timeMin =
    typeof a.durationMin === "number" ? Math.round(a.durationMin) : sessionTiming(session).total;
  const sessTime = timeMin > 0 ? `${timeMin} min` : "—";

  const sessHr = typeof a.avgHr === "number" ? `Avg ${Math.round(a.avgHr)} bpm` : "";
  const coachNote = (log.note && log.note.trim()) || "Logged and done. On to the next one.";

  return {
    type: "session",
    athlete,
    sessType: sessionTypeLabel(session),
    sessMain: mainSet(session),
    sessVol,
    sessTime,
    sessHr,
    coachNote,
  };
}
