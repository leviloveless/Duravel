"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkoutLog } from "@/lib/schemas";

/**
 * Quick session logger (Phase 2, Milestone 8 — phase2-spec.md §3a).
 *
 * One small control per session: a "Log" button (or the current log state as
 * a badge) that opens a fast modal — status, RPE, optional actuals, note.
 * Target interaction: under 10 seconds on a phone at the gym.
 */

export interface LogSessionProps {
  programId: string;
  weekNumber: number;
  day: WorkoutLog["day"];
  sessionIndex: number;
  /** Race sessions only allow completed/skipped, no partial. */
  isRace: boolean;
  existing: WorkoutLog | null;
  /** Week reviewed + applied → logs frozen. */
  frozen: boolean;
}

const STATUS_META: Record<WorkoutLog["status"], { label: string; badge: string; chip: string }> = {
  completed: { label: "Done", badge: "✓", chip: "bg-emerald-100 text-emerald-800" },
  partial: { label: "Partial", badge: "½", chip: "bg-amber-100 text-amber-800" },
  skipped: { label: "Skipped", badge: "✗", chip: "bg-zinc-200 text-zinc-600" },
};

export default function LogSession(props: LogSessionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<WorkoutLog["status"] | null>(props.existing?.status ?? null);
  const [rpe, setRpe] = useState<number | null>(props.existing?.rpe ?? null);
  const [durationMin, setDurationMin] = useState<string>(String(props.existing?.actuals?.durationMin ?? ""));
  const [distanceMiles, setDistanceMiles] = useState<string>(String(props.existing?.actuals?.distanceMiles ?? ""));
  const [avgHr, setAvgHr] = useState<string>(String(props.existing?.actuals?.avgHr ?? ""));
  const [note, setNote] = useState<string>(props.existing?.note ?? "");
  const [showActuals, setShowActuals] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = props.existing;
  const needsRpe = status !== null && status !== "skipped";

  async function save() {
    if (!status) return;
    if (needsRpe && rpe === null) {
      setError("Pick an RPE (1–10) — how hard did it feel?");
      return;
    }
    setSaving(true);
    setError(null);
    const actuals: Record<string, number> = {};
    if (durationMin && !Number.isNaN(Number(durationMin))) actuals.durationMin = Number(durationMin);
    if (distanceMiles && !Number.isNaN(Number(distanceMiles))) actuals.distanceMiles = Number(distanceMiles);
    if (avgHr && !Number.isNaN(Number(avgHr))) actuals.avgHr = Number(avgHr);
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programId: props.programId,
          weekNumber: props.weekNumber,
          day: props.day,
          sessionIndex: props.sessionIndex,
          status,
          rpe: status === "skipped" ? undefined : (rpe ?? undefined),
          actuals: Object.keys(actuals).length ? actuals : undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't save the log.");
        setSaving(false);
        return;
      }
      setSaving(false);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  // --- collapsed control ---
  const trigger = existing ? (
    <button
      type="button"
      onClick={() => !props.frozen && setOpen(true)}
      disabled={props.frozen}
      title={props.frozen ? "This week has been reviewed — logs are frozen" : "Edit log"}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_META[existing.status].chip} ${props.frozen ? "cursor-default opacity-70" : "hover:opacity-80"}`}
    >
      <span>{STATUS_META[existing.status].badge}</span>
      <span>{STATUS_META[existing.status].label}</span>
      {existing.rpe != null && <span className="font-normal">· RPE {existing.rpe}</span>}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => !props.frozen && setOpen(true)}
      disabled={props.frozen}
      title={props.frozen ? "This week has been reviewed — logs are frozen" : "Log this session"}
      className="rounded-full border border-zinc-300 px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
    >
      Log
    </button>
  );

  if (!open) return <span className="print:hidden">{trigger}</span>;

  return (
    <span className="print:hidden">
      {trigger}
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
        <div
          className="w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-sm font-semibold">Log session</h3>

          {/* Status */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(props.isRace ? (["completed", "skipped"] as const) : (["completed", "partial", "skipped"] as const)).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                  status === s ? "border-black bg-black text-white" : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                {STATUS_META[s].label}
              </button>
            ))}
          </div>

          {/* RPE */}
          {needsRpe && (
            <div className="mt-4">
              <p className="text-xs font-medium text-zinc-500">Effort (RPE 1 = easy · 10 = max)</p>
              <div className="mt-1.5 grid grid-cols-10 gap-1">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRpe(n)}
                    className={`rounded-md py-1.5 text-xs font-semibold tabular-nums transition-colors ${
                      rpe === n ? "bg-black text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Optional actuals */}
          <button
            type="button"
            onClick={() => setShowActuals((v) => !v)}
            className="mt-4 text-xs font-medium text-zinc-500 underline"
          >
            {showActuals ? "Hide details" : "Add details (time / distance / HR)"}
          </button>
          {showActuals && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
                Minutes
                <input
                  type="number"
                  inputMode="decimal"
                  value={durationMin}
                  onChange={(e) => setDurationMin(e.target.value)}
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-800"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
                Miles
                <input
                  type="number"
                  inputMode="decimal"
                  value={distanceMiles}
                  onChange={(e) => setDistanceMiles(e.target.value)}
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-800"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
                Avg HR
                <input
                  type="number"
                  inputMode="numeric"
                  value={avgHr}
                  onChange={(e) => setAvgHr(e.target.value)}
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-800"
                />
              </label>
            </div>
          )}

          {/* Note */}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 280))}
            placeholder="Note (optional) — e.g. knee felt off on lunges"
            rows={2}
            className="mt-3 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-800 placeholder:text-zinc-400"
          />

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !status}
              className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </span>
  );
}
