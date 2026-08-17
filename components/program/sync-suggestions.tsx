"use client";

import { useState, useTransition } from "react";
import { linkActivityToSession, dismissSuggestion } from "@/app/activity/actions";
import { encodeSessionValue, decodeSessionValue } from "@/lib/wearables/link";
import type { SyncSuggestion } from "@/lib/wearables/suggest-data";

const DAY_LONG: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

/**
 * Same-day link suggestions banner shown at the top of the program view
 * (Sync-Linking Increment 3, rules #2.1 same-day match with confirmation and
 * #2.2 multi-planned-day picker). Each suggestion is a synced activity that
 * lands on a planned day; the athlete confirms the match (choosing which
 * session when the day has more than one). Linking reuses the same server
 * action as the Activity dashboard, so a confirmed match writes a workout_log
 * and feeds the adaptation engine. Confirmed/dismissed cards drop out locally;
 * a full refresh (the action revalidates) also removes linked ones.
 */
export default function SyncSuggestions({
  programId,
  suggestions,
}: {
  programId: string;
  suggestions: SyncSuggestion[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = suggestions.filter((s) => !hidden.has(s.activityId));
  if (visible.length === 0) return null;

  function hide(activityId: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.add(activityId);
      return next;
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4 print:hidden">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-sky-900">
          Synced workouts ready to link ({visible.length})
        </h2>
        <p className="text-xs text-sky-800/80">
          These synced workouts match a planned day. Confirm a match to count it toward your
          training and weekly adjustments.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {visible.map((s) => (
          <SuggestionCard
            key={s.activityId}
            programId={programId}
            suggestion={s}
            onDone={() => hide(s.activityId)}
          />
        ))}
      </ul>
    </section>
  );
}

function SuggestionCard({
  programId,
  suggestion,
  onDone,
}: {
  programId: string;
  suggestion: SyncSuggestion;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const first = suggestion.candidates[0]!;
  const [sessionValue, setSessionValue] = useState<string>(encodeSessionValue(first));
  const multi = suggestion.candidates.length > 1;

  /**
   * Dismiss = "stop suggesting this", written down (migration 0043). It used to
   * be local state only, so the card returned on every reload and on every
   * `router.refresh()` the Sync workouts button fires. The card is hidden
   * optimistically and stays hidden even if the write fails — the athlete asked
   * for it gone, and the error explains why it may return.
   */
  function dismiss() {
    setError(null);
    onDone();
    startTransition(async () => {
      const res = await dismissSuggestion(suggestion.activityId, programId);
      if (!res.ok) setError(res.error);
    });
  }

  function confirm() {
    setError(null);
    const pos = decodeSessionValue(sessionValue);
    if (!pos) {
      setError("Pick a session.");
      return;
    }
    startTransition(async () => {
      const res = await linkActivityToSession({
        activityId: suggestion.activityId,
        programId,
        weekNumber: pos.weekNumber,
        day: pos.day,
        sessionIndex: pos.sessionIndex,
      });
      if (!res.ok) setError(res.error);
      else onDone();
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-sky-100 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-zinc-800">{suggestion.title}</span>
        <span className="text-xs text-zinc-500">{suggestion.detail}</span>
      </div>

      <p className="text-xs text-zinc-600">
        {multi ? (
          <>
            Landed on{" "}
            <span className="font-medium">
              {DAY_LONG[suggestion.day] ?? suggestion.day} · Week {suggestion.weekNumber}
            </span>
            . Which planned session did this complete?
          </>
        ) : (
          <>
            Matches your{" "}
            <span className="font-medium">{first.label}</span> on{" "}
            <span className="font-medium">
              {DAY_LONG[suggestion.day] ?? suggestion.day} · Week {suggestion.weekNumber}
            </span>
            .
          </>
        )}
      </p>

      {multi && (
        <select
          value={sessionValue}
          onChange={(e) => setSessionValue(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"
        >
          {suggestion.candidates.map((c) => {
            const value = encodeSessionValue(c);
            return (
              <option key={value} value={value}>
                {c.label}
              </option>
            );
          })}
        </select>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-800 disabled:opacity-50"
        >
          {pending ? "Linking…" : multi ? "Link selected session" : "Confirm match"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          title="Stop suggesting this workout — you can still attach it by hand from the week below"
          className="rounded-md px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
    </li>
  );
}
