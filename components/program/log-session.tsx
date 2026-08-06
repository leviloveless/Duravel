"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkoutLog } from "@/lib/schemas";
import { usePostAction } from "@/lib/hooks/use-post-action";
import { resolveActualDay } from "@/lib/wearables/link";
import { Button } from "@/components/ui/button";
import ResultCardLauncher from "./result-card-launcher";
import type { CardData } from "./result-card";

const DAY_OPTIONS: { key: WorkoutLog["day"]; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

/** Exact recovery-awareness copy shown before a session is moved off its
 *  planned day (rule #5 — do not alter this wording). */
const MOVE_DAY_CONFIRM_COPY =
  "Please confirm that you have completed or plan to complete this workout on the selected day. Be aware that completing workouts in a different order or on different days throughout the week may impact your ability to recover from workout to workout and from week to week.";

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
  /**
   * Seed for the result card, so a completed log can offer it on the spot. The
   * capability shipped long ago — Strava forbids third-party photo upload, but
   * the studio rasterizes a 1080px PNG the athlete attaches themselves — and
   * nothing pointed anyone at it in the one moment they'd want it. Omitted (or
   * on a race row) → no nudge, and this component behaves exactly as before.
   */
  cardData?: Partial<CardData>;
}

const STATUS_META: Record<WorkoutLog["status"], { label: string; badge: string; chip: string }> = {
  completed: { label: "Done", badge: "✓", chip: "bg-emerald-100 text-emerald-800" },
  partial: { label: "Partial", badge: "½", chip: "bg-amber-100 text-amber-800" },
  skipped: { label: "Skipped", badge: "✗", chip: "bg-zinc-200 text-zinc-600" },
};

export default function LogSession(props: LogSessionProps) {
  const { run, pending, error } = usePostAction("/api/logs");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<WorkoutLog["status"] | null>(props.existing?.status ?? null);
  const [rpe, setRpe] = useState<number | null>(props.existing?.rpe ?? null);
  const [durationMin, setDurationMin] = useState<string>(String(props.existing?.actuals?.durationMin ?? ""));
  const [distanceMiles, setDistanceMiles] = useState<string>(String(props.existing?.actuals?.distanceMiles ?? ""));
  const [avgHr, setAvgHr] = useState<string>(String(props.existing?.actuals?.avgHr ?? ""));
  const [note, setNote] = useState<string>(props.existing?.note ?? "");
  const [showActuals, setShowActuals] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [override, setOverride] = useState<WorkoutLog | null>(null);
  // Rule #5: the day the session was actually done. Defaults to the planned day;
  // choosing another day triggers the recovery-awareness confirmation on save.
  const [actualDay, setActualDay] = useState<WorkoutLog["day"]>(
    props.existing?.actualDay ?? props.day,
  );
  const [showMoveConfirm, setShowMoveConfirm] = useState(false);
  // Post-save card nudge (Levi, 2026-08-06). Shown only after a save that turned
  // the session GREEN — a partial or a skip is not a result worth posting.
  const [nudge, setNudge] = useState(false);

  const existing = override ?? props.existing;
  const needsRpe = status !== null && status !== "skipped";
  const isMoved = resolveActualDay(props.day, actualDay) !== null;

  // Accessible dialog behaviour (roadmap #1.2): focus the panel on open, trap
  // Tab inside it, close on Escape, and restore focus to the trigger on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const focusable = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute("disabled"))
        : [];
    (focusable()[0] ?? node)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusable();
      const first = els[0];
      const last = els[els.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  function save() {
    if (!status) return;
    if (needsRpe && rpe === null) {
      setFormError("Pick an RPE (1–10) — how hard did it feel?");
      return;
    }
    setFormError(null);
    // Rule #5: moving the session off its planned day requires an explicit
    // recovery-awareness confirmation before we persist.
    if (isMoved) {
      setShowMoveConfirm(true);
      return;
    }
    void persist();
  }

  async function persist() {
    if (!status) return;
    setShowMoveConfirm(false);
    const movedDay = resolveActualDay(props.day, actualDay);
    const actuals: NonNullable<WorkoutLog["actuals"]> = {};
    if (durationMin && !Number.isNaN(Number(durationMin))) actuals.durationMin = Number(durationMin);
    if (distanceMiles && !Number.isNaN(Number(distanceMiles))) actuals.distanceMiles = Number(distanceMiles);
    if (avgHr && !Number.isNaN(Number(avgHr))) actuals.avgHr = Number(avgHr);
    const hasActuals = Object.keys(actuals).length > 0;

    // Optimistic (roadmap #2.2): reflect the new log on the badge and close the
    // modal immediately; revert + reopen with the error if the request fails.
    const optimistic: WorkoutLog = {
      weekNumber: props.weekNumber,
      day: props.day,
      sessionIndex: props.sessionIndex,
      status,
      rpe: status === "skipped" ? null : rpe,
      actuals: hasActuals ? actuals : null,
      note: note.trim() || null,
      actualDay: movedDay as WorkoutLog["day"] | null,
    };
    const prev = override;
    setOverride(optimistic);
    setOpen(false);

    const r = await run({
      programId: props.programId,
      weekNumber: props.weekNumber,
      day: props.day,
      sessionIndex: props.sessionIndex,
      status,
      rpe: status === "skipped" ? undefined : (rpe ?? undefined),
      actuals: hasActuals ? actuals : undefined,
      note: note.trim() || undefined,
      actualDay: movedDay ?? undefined,
    });
    if (!r?.ok) {
      setOverride(prev);
      setOpen(true);
      return;
    }
    if (status === "completed" && props.cardData) setNudge(true);
  }

  // The nudge is a prompt, not an alert: it clears itself so a session logged
  // and left alone doesn't leave a card offer sitting on the screen.
  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => setNudge(false), 12_000);
    return () => clearTimeout(t);
  }, [nudge]);

  const cardNudge = nudge ? (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[70] flex justify-center px-3 pb-3 print:hidden sm:bottom-4"
    >
      <div className="flex w-full max-w-sm items-center gap-3 rounded-xl bg-zinc-900 px-4 py-3 text-white shadow-xl">
        <span className="text-sm font-medium">Nice work — share it?</span>
        <span className="ml-auto flex items-center gap-2">
          <ResultCardLauncher
            label="Result card"
            initial={props.cardData}
            className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-900 transition-colors hover:bg-zinc-200"
          />
          <button
            type="button"
            onClick={() => setNudge(false)}
            aria-label="Dismiss"
            className="text-xs text-zinc-400 transition-colors hover:text-white"
          >
            ✕
          </button>
        </span>
      </div>
    </div>
  ) : null;

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
      {existing.actualDay && existing.actualDay !== existing.day && (
        <span className="font-normal" title="Completed on a different day than planned">
          · {DAY_OPTIONS.find((d) => d.key === existing.actualDay)?.label ?? existing.actualDay}
        </span>
      )}
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

  if (!open)
    return (
      <span className="print:hidden">
        {trigger}
        {cardNudge}
      </span>
    );

  return (
    <span className="print:hidden">
      {trigger}
      {cardNudge}
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="log-session-title"
          tabIndex={-1}
          className="w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-xl outline-none sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 id="log-session-title" className="text-sm font-semibold">
            Log session
          </h3>

          {/* Status */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(props.isRace ? (["completed", "skipped"] as const) : (["completed", "partial", "skipped"] as const)).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
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
                    aria-pressed={rpe === n}
                    aria-label={`RPE ${n}`}
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
            aria-expanded={showActuals}
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

          {/* Day completed (rule #5) — defaults to the planned day; a different
              choice records actual_day after the recovery-awareness confirm. */}
          <div className="mt-4">
            <p className="text-xs font-medium text-zinc-500">Day completed</p>
            <div className="mt-1.5 grid grid-cols-7 gap-1">
              {DAY_OPTIONS.map((d) => {
                const selected = actualDay === d.key;
                const planned = props.day === d.key;
                return (
                  <button
                    key={d.key}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`Completed ${d.label}${planned ? " (planned)" : ""}`}
                    onClick={() => setActualDay(d.key)}
                    className={`rounded-md py-1.5 text-[11px] font-semibold transition-colors ${
                      selected
                        ? "bg-black text-white"
                        : planned
                          ? "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            {isMoved && (
              <p className="mt-1 text-[11px] text-amber-700">
                Moved off the planned day — you’ll confirm before saving.
              </p>
            )}
          </div>

          {/* Note */}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 280))}
            placeholder="Note (optional) — e.g. knee felt off on lunges"
            rows={2}
            className="mt-3 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-800 placeholder:text-zinc-400"
          />

          {(formError ?? error) && (
            <p className="mt-2 text-xs text-red-600">{formError ?? error}</p>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={save} disabled={pending || !status} className="px-5">
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>

      {/* Move-day confirmation (rule #5) — exact recovery-awareness copy. */}
      {showMoveConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={() => setShowMoveConfirm(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="move-day-title"
            className="w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="move-day-title" className="text-sm font-semibold">
              Confirm day change
            </h3>
            <p className="mt-2 text-sm text-zinc-600">{MOVE_DAY_CONFIRM_COPY}</p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowMoveConfirm(false)}>
                Go back
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void persist()}
                disabled={pending}
                className="px-5"
              >
                {pending ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
