"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@/lib/schemas";
import {
  LIFT_TYPE_LABEL,
  elementLine,
  hybridHeader,
  movementLine,
  powerElementLine,
  raceLabel,
  runLine,
} from "./format";

/**
 * Mobile "Workout view": check off each element of the day's session(s) as you
 * go, then mark the session complete (writes one log via /api/logs). Gated to
 * the native app — on the web it shows a fallback unless `?preview` is present.
 */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function sessionTitle(s: Session): string {
  switch (s.kind) {
    case "run":
      return `${cap(s.runType.replace(/_/g, " "))} run`;
    case "lift":
      return LIFT_TYPE_LABEL[s.liftType];
    case "hybrid":
      return hybridHeader(s);
    case "swim":
      return `${cap(s.sessionType.replace(/_/g, " "))} swim`;
    case "bike":
      return `${cap(s.sessionType.replace(/_/g, " "))} ride`;
    case "brick":
      return "Brick";
    case "cardio":
      return s.modality ?? "Zone 1–2 cardio";
    case "race":
      return "Race";
    default:
      return "Session";
  }
}

function sessionItems(s: Session): string[] {
  switch (s.kind) {
    case "run":
      return [runLine(s)];
    case "lift": {
      const items = s.movements.map(movementLine);
      const power = powerElementLine(s.power);
      if (power) items.push(power);
      return items;
    }
    case "hybrid":
      return s.elements.map(elementLine);
    case "brick":
      return s.segments.map(
        (seg) => `${cap(seg.discipline)} — ${Math.round(seg.durationMin)} min — Zone ${seg.goalZone}`,
      );
    case "swim":
    case "bike":
    case "cardio":
      return [`${Math.round(s.durationMin)} min — Zone ${s.goalZone}`];
    case "race":
      return [raceLabel(s.priority)];
    default:
      return [];
  }
}

function useIsNative(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    const native = !!w.Capacitor?.isNativePlatform?.();
    const preview = new URLSearchParams(window.location.search).has("preview");
    setOk(native || preview);
  }, []);
  return ok;
}

const RPE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function SessionBlock({
  programId,
  weekNumber,
  day,
  sessionIndex,
  session,
}: {
  programId: string;
  weekNumber: number;
  day: string;
  sessionIndex: number;
  session: Session;
}) {
  const items = sessionItems(session);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [rpe, setRpe] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function complete() {
    setStatus("saving");
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programId,
          weekNumber,
          day,
          sessionIndex,
          status: "completed",
          rpe: rpe ?? 5,
        }),
      });
      setStatus(res.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  const allChecked = items.length > 0 && checked.size >= items.length;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold tracking-tight text-zinc-900">{sessionTitle(session)}</h2>

      <ul className="mt-3 flex flex-col gap-1.5">
        {items.map((label, i) => {
          const on = checked.has(i);
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggle(i)}
                className="flex w-full items-start gap-3 rounded-lg px-1 py-2 text-left active:bg-zinc-50"
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                    on ? "border-black bg-black text-white" : "border-zinc-300"
                  }`}
                  aria-hidden
                >
                  {on ? "✓" : ""}
                </span>
                <span className={`text-sm ${on ? "text-zinc-400 line-through" : "text-zinc-800"}`}>
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {status === "done" ? (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
          ✓ Logged as completed
        </p>
      ) : (
        <div className="mt-4 border-t border-zinc-100 pt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            How hard was it? (RPE)
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {RPE.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRpe(n)}
                className={`h-9 w-9 rounded-full text-sm font-medium transition-colors ${
                  rpe === n ? "bg-black text-white" : "bg-zinc-100 text-zinc-700"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={complete}
            disabled={status === "saving"}
            className={`mt-4 w-full rounded-full py-3 text-sm font-semibold transition-colors disabled:opacity-60 ${
              allChecked ? "bg-black text-white hover:bg-zinc-800" : "bg-zinc-900 text-white"
            }`}
          >
            {status === "saving" ? "Saving…" : allChecked ? "Complete workout" : "Mark complete"}
          </button>
          {status === "error" && (
            <p className="mt-2 text-sm text-red-600">Couldn&apos;t save — try again.</p>
          )}
        </div>
      )}
    </section>
  );
}

export default function WorkoutView({
  programId,
  weekNumber,
  day,
  sessions,
}: {
  programId: string;
  weekNumber: number;
  day: string;
  sessions: Session[];
}) {
  const native = useIsNative();

  const trackable = sessions;

  if (!native) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center">
        <p className="text-sm font-medium text-zinc-800">Workout view lives in the Duravel app</p>
        <p className="mt-1 text-sm text-zinc-500">
          Open this workout in the Duravel mobile app to check off each move as you train.
        </p>
        <Link
          href={`/program/${programId}`}
          className="mt-4 inline-block rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700"
        >
          Back to program
        </Link>
      </div>
    );
  }

  if (trackable.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center text-sm text-zinc-500">
        Rest day — nothing to log. Enjoy the recovery.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sessions.map((s, si) => (
        <SessionBlock
          key={si}
          programId={programId}
          weekNumber={weekNumber}
          day={day}
          sessionIndex={si}
          session={s}
        />
      ))}
    </div>
  );
}
