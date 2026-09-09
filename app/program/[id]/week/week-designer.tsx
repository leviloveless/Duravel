"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveWeekTemplate, clearWeekTemplate } from "./actions";
import { validateTemplate, type TemplateIssue } from "@/lib/engine/template-validate";
import { suggestTemplate, TEMPLATE_GOALS, type TemplateGoal } from "@/lib/engine/template-presets";
import type { TemplateContext } from "@/lib/engine/template-validate";
import type { TemplateSession, TrainingDayName, WeekTemplate } from "@/lib/engine/types";

const DAY_ORDER: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_SHORT: Record<TrainingDayName, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** The grid being edited: every training day, most of them usually empty. */
type Week = Record<TrainingDayName, TemplateSession[]>;

const emptyWeek = (days: TrainingDayName[]): Week =>
  Object.fromEntries(days.map((d) => [d, [] as TemplateSession[]])) as Week;

/**
 * How many steps of undo to keep.
 *
 * Deep enough that backing out of a preset and the handful of edits around it
 * always works, shallow enough that the history cannot grow without bound in a
 * long session. Nobody is undoing twenty-one steps of a seven-day grid.
 */
const MAX_UNDO = 20;

/**
 * What the athlete can put on a day.
 *
 * "Run — you pick" is first on purpose. It is the option most athletes should
 * take for their non-key days and the one they would never think to ask for: it
 * hands the slot back to the phase, so a single authored week still progresses
 * base → build → peak instead of being the same week sixteen times.
 */
const CHOICES: { label: string; hint?: string; session: TemplateSession }[] = [
  { label: "Run — you pick", hint: "changes with the phase", session: { kind: "run" } },
  { label: "Easy run", session: { kind: "run", runType: "easy" } },
  { label: "Long run", hint: "one per week", session: { kind: "run", runType: "long" } },
  { label: "Threshold run", session: { kind: "run", runType: "threshold" } },
  { label: "Interval run", session: { kind: "run", runType: "interval" } },
  { label: "Tempo run", session: { kind: "run", runType: "tempo" } },
  { label: "Fartlek", session: { kind: "run", runType: "fartlek" } },
  { label: "Hybrid / stations", session: { kind: "hybrid" } },
  { label: "Brick", hint: "bike, then run", session: { kind: "brick" } },
  { label: "Lift — full body", session: { kind: "lift", liftType: "full" } },
  { label: "Lift — upper", session: { kind: "lift", liftType: "upper" } },
  { label: "Lift — lower", session: { kind: "lift", liftType: "lower" } },
  {
    label: "Lift — power",
    hint: "the race's four stations",
    session: { kind: "lift", liftType: "power" },
  },
];

const LIFT_LABEL: Record<NonNullable<TemplateSession["liftType"]>, string> = {
  full: "full body",
  upper: "upper",
  lower: "lower",
  power: "power",
};

function sessionLabel(s: TemplateSession): string {
  if (s.kind === "hybrid") return "Hybrid";
  if (s.kind === "brick") return "Brick · bike→run";
  if (s.kind === "lift") return `Lift · ${LIFT_LABEL[s.liftType ?? "full"]}`;
  if (s.runType === undefined) return "Run · you pick";
  const nice: Record<string, string> = {
    easy: "Easy run",
    long: "Long run",
    threshold: "Threshold",
    interval: "Intervals",
    tempo: "Tempo",
    fartlek: "Fartlek",
    progression: "Progression",
    hybrid_run: "Run",
  };
  return nice[s.runType] ?? s.runType;
}

const SEVERITY_STYLE: Record<TemplateIssue["severity"], string> = {
  blocking: "border-red-200 bg-red-50 text-red-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  note: "border-zinc-200 bg-zinc-50 text-zinc-700",
};
const SEVERITY_LABEL: Record<TemplateIssue["severity"], string> = {
  blocking: "Can't build",
  warning: "Heads up",
  note: "Note",
};

export default function WeekDesigner({
  programId,
  initial,
  context,
  includeHybrid,
}: {
  programId: string;
  initial: WeekTemplate | null;
  context: TemplateContext;
  includeHybrid: boolean;
}) {
  const trainingDays = DAY_ORDER.filter((d) => context.trainingDays.includes(d));
  const [week, setWeek] = useState<Week>(() => {
    const base = emptyWeek(trainingDays);
    for (const d of initial?.days ?? []) {
      if (base[d.day]) base[d.day] = [...d.sessions];
    }
    return base;
  });
  /**
   * Undo history, oldest first. Each entry is the grid as it stood BEFORE the
   * action its `label` names, so undoing means restoring `week` and dropping the
   * entry.
   *
   * This exists because of the presets (Levi, 2026-09-09). A preset replaces the
   * whole grid in one click, and taking it back by hand meant deleting five or
   * six sessions one at a time — a punishment for trying one out, on the very
   * control whose whole job is to be tried out. Undo covers every edit rather
   * than only presets: a button that works for one kind of change and silently
   * does nothing for another is worse than no button.
   */
  const [history, setHistory] = useState<{ week: Week; label: string }[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const template: WeekTemplate = useMemo(
    () => ({
      days: trainingDays
        .map((d) => ({ day: d, sessions: week[d] ?? [] }))
        .filter((d) => d.sessions.length > 0),
    }),
    [week, trainingDays],
  );

  // The SAME validator the server runs at save. Running it here as the athlete
  // types is the entire point of the tier — the rules explain themselves while
  // the week is still being written, not after it has been submitted.
  const issues = useMemo(() => validateTemplate(template, context), [template, context]);
  const blocking = issues.filter((i) => i.severity === "blocking");
  const sessionCount = template.days.reduce((n, d) => n + d.sessions.length, 0);

  /**
   * The single way the grid changes.
   *
   * Everything routes through here so that (a) nothing can change without an
   * undo entry, and (b) `setSaved(false)` happens ONCE per user action. It used
   * to be called from inside the `setWeek` updater, which React is free to run
   * twice — a state setter inside a state updater is a bug waiting for the day
   * someone turns on StrictMode.
   */
  const mutate = (label: string, next: (w: Week) => Week) => {
    setHistory((h) => [...h, { week, label }].slice(-MAX_UNDO));
    setWeek(next);
    setSaved(false);
  };

  const addTo = (day: TrainingDayName, s: TemplateSession) => {
    if ((week[day] ?? []).length >= 2) return;
    mutate(`adding ${sessionLabel(s)}`, (w) => ({ ...w, [day]: [...(w[day] ?? []), s] }));
  };

  const removeFrom = (day: TrainingDayName, i: number) => {
    const s = week[day]?.[i];
    if (!s) return;
    mutate(`removing ${sessionLabel(s)}`, (w) => ({
      ...w,
      [day]: (w[day] ?? []).filter((_, k) => k !== i),
    }));
  };

  const applyPreset = (goal: TemplateGoal) => {
    const t = suggestTemplate(goal, {
      trainingDays,
      includeHybrid,
      peakMileage: context.peakMileage,
    });
    const next = emptyWeek(trainingDays);
    for (const d of t.days) next[d.day] = [...d.sessions];
    const name = TEMPLATE_GOALS.find((g) => g.id === goal)?.label ?? "that preset";
    mutate(`\u201C${name}\u201D`, () => next);
  };

  const lastChange = history[history.length - 1];

  const undo = () => {
    if (!lastChange) return;
    setHistory((h) => h.slice(0, -1));
    setWeek(lastChange.week);
    setSaved(false);
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await saveWeekTemplate(programId, template);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.push(`/program/${programId}`);
      router.refresh();
    });

  const reset = () =>
    startTransition(async () => {
      setError(null);
      const res = await clearWeekTemplate(programId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/program/${programId}`);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-900">Start from a goal</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {TEMPLATE_GOALS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => applyPreset(g.id)}
              className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 text-left transition-colors hover:border-zinc-400"
            >
              <span className="text-sm font-medium">{g.label}</span>
              <span className="text-xs leading-relaxed text-zinc-500">{g.blurb}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-500">
          These replace whatever is in the grid — Undo, above the grid, puts back exactly what was
          there. Everything is editable afterwards: they are a correct week to react to, not a week
          you are stuck with.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
          <h2 className="text-sm font-medium text-zinc-900">Your week</h2>
          <div className="flex flex-wrap items-baseline gap-3">
            {lastChange && (
              <button
                type="button"
                onClick={undo}
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 transition-colors hover:border-zinc-500 hover:text-black"
              >
                Undo {lastChange.label}
              </button>
            )}
            <span className="text-xs text-zinc-500">
              {sessionCount} session{sessionCount === 1 ? "" : "s"} · two a day maximum
            </span>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trainingDays.map((day) => (
            <DayCard
              key={day}
              day={day}
              sessions={week[day] ?? []}
              issues={issues.filter((i) => i.day === day)}
              onAdd={(s) => addTo(day, s)}
              onRemove={(i) => removeFrom(day, i)}
            />
          ))}
        </div>
        <p className="text-xs text-zinc-500">
          Say what and where. Distances and durations are the engine&apos;s — it sizes every session
          from your mileage target, and still handles deloads, tapers and race week.
        </p>
      </section>

      {issues.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-900">What the engine thinks</h2>
          {issues.map((i, k) => (
            <div
              key={`${i.code}-${i.day ?? ""}-${k}`}
              className={`flex flex-col gap-1 rounded-xl border p-4 text-sm ${SEVERITY_STYLE[i.severity]}`}
            >
              <span className="text-xs font-medium uppercase tracking-wide opacity-70">
                {SEVERITY_LABEL[i.severity]}
                {i.day ? ` · ${DAY_SHORT[i.day]}` : ""}
              </span>
              <span className="leading-relaxed">{i.message}</span>
            </div>
          ))}
        </section>
      )}

      {issues.length === 0 && sessionCount > 0 && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Nothing to flag — the engine will build this week as you have written it.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || blocking.length > 0 || sessionCount === 0}
          className="rounded-full bg-black px-6 py-3 text-sm text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : saved ? "Saved" : "Save week and rebuild"}
        </button>
        {initial && (
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="rounded-full border border-zinc-300 px-6 py-3 text-sm transition-colors hover:border-zinc-500 disabled:opacity-50"
          >
            Go back to the engine&apos;s week
          </button>
        )}
        {blocking.length > 0 && (
          <span className="text-xs text-red-600">
            Fix the {blocking.length} blocking item{blocking.length === 1 ? "" : "s"} above to save.
          </span>
        )}
      </div>
    </div>
  );
}

function DayCard({
  day,
  sessions,
  issues,
  onAdd,
  onRemove,
}: {
  day: TrainingDayName;
  sessions: TemplateSession[];
  issues: TemplateIssue[];
  onAdd: (s: TemplateSession) => void;
  onRemove: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const worst = issues.some((i) => i.severity === "blocking")
    ? "blocking"
    : issues.some((i) => i.severity === "warning")
      ? "warning"
      : null;

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 ${
        worst === "blocking"
          ? "border-red-300"
          : worst === "warning"
            ? "border-amber-300"
            : "border-zinc-200"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{DAY_SHORT[day]}</span>
        {sessions.length === 0 && <span className="text-xs text-zinc-400">Rest</span>}
      </div>

      <ul className="flex flex-col gap-2">
        {sessions.map((s, i) => (
          <li
            key={`${s.kind}-${i}`}
            className="flex items-center justify-between rounded-lg bg-zinc-100 px-3 py-2 text-sm"
          >
            <span>{sessionLabel(s)}</span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove ${sessionLabel(s)} from ${DAY_SHORT[day]}`}
              className="text-zinc-400 transition-colors hover:text-red-600"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {sessions.length < 2 &&
        (open ? (
          <div className="flex flex-col gap-1">
            {CHOICES.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => {
                  onAdd(c.session);
                  setOpen(false);
                }}
                className="flex items-baseline justify-between rounded-lg px-3 py-1.5 text-left text-sm transition-colors hover:bg-zinc-100"
              >
                <span>{c.label}</span>
                {c.hint && <span className="text-xs text-zinc-400">{c.hint}</span>}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-left text-xs text-zinc-500 hover:text-black"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 transition-colors hover:border-zinc-500 hover:text-black"
          >
            + Add session
          </button>
        ))}
    </div>
  );
}
