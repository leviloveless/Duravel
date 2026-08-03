"use client";

import { useState, useTransition } from "react";
import { addExtraWorkout, addExtraFromActivity, deleteExtraWorkout } from "@/app/program/extra-actions";
import { extraDetail, extraTitle } from "@/lib/extra-workouts";
import type { ExtraWorkout, ExtraWorkoutKindName } from "@/lib/schemas";
import type { SyncActivitySummary } from "@/lib/wearables/suggest-data";

/**
 * Record a workout the program didn't plan — on a rest day, or on top of a day
 * that already has sessions.
 *
 * Two ways in, per the athlete's choice: attach a workout their wearable already
 * synced (nothing to retype), or type it in structured — kind, duration,
 * distance, HR, zone, RPE, note — so it reads like any other session. Extras are
 * stored outside the program blob, so they never alter the engine's prescribed
 * weekly volume and they survive a Recalculate.
 */

const KINDS: { value: ExtraWorkoutKindName; label: string }[] = [
  { value: "run", label: "Run" },
  { value: "lift", label: "Strength" },
  { value: "hybrid", label: "Hybrid / HYROX" },
  { value: "cardio", label: "Other cardio" },
  { value: "other", label: "Something else" },
];

const inputClass =
  "w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900";

export function ExtraWorkoutList({
  programId,
  extras,
  frozen,
}: {
  programId: string;
  extras: ExtraWorkout[];
  frozen?: boolean;
}) {
  if (extras.length === 0) return null;
  return (
    <>
      {extras.map((x) => (
        <ExtraWorkoutRow key={x.id} programId={programId} extra={x} frozen={frozen} />
      ))}
    </>
  );
}

function ExtraWorkoutRow({
  programId,
  extra,
  frozen,
}: {
  programId: string;
  extra: ExtraWorkout;
  frozen?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const detail = extraDetail(extra);
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-zinc-800">
          <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-400" />
          <span className="truncate">{extraTitle(extra)}</span>
          <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
            extra
          </span>
        </span>
        {!frozen && (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => void deleteExtraWorkout(programId, extra.id))}
            className="shrink-0 text-xs text-zinc-400 transition-colors hover:text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
      {detail && <div className="mt-0.5 text-xs text-zinc-500">{detail}</div>}
      {extra.note && <div className="mt-1 text-xs text-zinc-600">{extra.note}</div>}
    </div>
  );
}

export function AddExtraWorkout({
  programId,
  weekNumber,
  day,
  activities = [],
  compact,
}: {
  programId: string;
  weekNumber: number;
  day: string;
  /** Already-synced workouts the athlete can attach instead of typing one in. */
  activities?: SyncActivitySummary[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<ExtraWorkoutKindName>("run");
  const [title, setTitle] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [distanceMiles, setDistanceMiles] = useState("");
  const [avgHr, setAvgHr] = useState("");
  const [rpe, setRpe] = useState("");
  const [note, setNote] = useState("");
  const [activityId, setActivityId] = useState("");

  function reset() {
    setKind("run");
    setTitle("");
    setDurationMin("");
    setDistanceMiles("");
    setAvgHr("");
    setRpe("");
    setNote("");
    setActivityId("");
    setError(null);
  }

  function num(v: string): number | undefined {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
  }

  function submitManual() {
    setError(null);
    const duration = num(durationMin);
    const distance = num(distanceMiles);
    if (duration === undefined && distance === undefined && title.trim() === "") {
      setError("Add at least a name, a duration, or a distance.");
      return;
    }
    startTransition(async () => {
      const res = await addExtraWorkout({
        programId,
        weekNumber,
        day,
        kind,
        title: title.trim() || undefined,
        durationMin: duration !== undefined ? Math.round(duration) : undefined,
        distanceMiles: distance,
        avgHr: num(avgHr) !== undefined ? Math.round(num(avgHr)!) : undefined,
        rpe: num(rpe) !== undefined ? Math.round(num(rpe)!) : undefined,
        note: note.trim() || undefined,
      });
      if (res.ok) {
        reset();
        setOpen(false);
      } else setError(res.error);
    });
  }

  function submitFromActivity() {
    setError(null);
    if (!activityId) {
      setError("Pick a synced workout.");
      return;
    }
    startTransition(async () => {
      const res = await addExtraFromActivity(programId, weekNumber, day, activityId);
      if (res.ok) {
        reset();
        setOpen(false);
      } else setError(res.error);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? "text-xs text-zinc-400 transition-colors hover:text-zinc-900 print:hidden"
            : "self-start rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs text-zinc-500 transition-colors hover:border-zinc-900 hover:text-zinc-900 print:hidden"
        }
      >
        ＋ Add a workout
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-300 bg-white p-3 text-sm print:hidden">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">Add a workout you did</span>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-xs text-zinc-500 hover:text-zinc-900"
        >
          Cancel
        </button>
      </div>

      {activities.length > 0 && (
        <div className="mb-3 border-b border-zinc-100 pb-3">
          <label className="mb-1 block text-xs text-zinc-500">From a synced workout</label>
          <div className="flex gap-2">
            <select
              value={activityId}
              onChange={(e) => setActivityId(e.target.value)}
              className={inputClass}
            >
              <option value="">Choose…</option>
              {activities.map((a) => (
                <option key={a.activityId} value={a.activityId}>
                  {a.title} — {a.detail}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending}
              onClick={submitFromActivity}
              className="shrink-0 rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value as ExtraWorkoutKindName)} className={inputClass}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Name (optional)
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className={inputClass} placeholder="e.g. Pickup basketball" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Minutes
            <input value={durationMin} onChange={(e) => setDurationMin(e.target.value)} inputMode="numeric" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Miles
            <input value={distanceMiles} onChange={(e) => setDistanceMiles(e.target.value)} inputMode="decimal" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Avg HR
            <input value={avgHr} onChange={(e) => setAvgHr(e.target.value)} inputMode="numeric" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            RPE 1–10
            <input value={rpe} onChange={(e) => setRpe(e.target.value)} inputMode="numeric" className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Notes (optional)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} rows={2} className={inputClass} />
        </label>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={submitManual}
          className="rounded-full bg-black px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save workout"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">
        Extra workouts are tracked separately — your week&apos;s prescribed volume stays as the engine planned it.
      </p>
    </div>
  );
}
