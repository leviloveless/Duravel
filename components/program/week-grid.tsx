"use client";

import { useEffect, useMemo, useState } from "react";
import { validateTemplate, type TemplateIssue } from "@/lib/engine/template-validate";
import { suggestTemplate, TEMPLATE_GOALS, type TemplateGoal } from "@/lib/engine/template-presets";
import type { TemplateContext } from "@/lib/engine/template-validate";
import type { TemplateSession, TrainingDayName, WeekTemplate } from "@/lib/engine/types";

/**
 * The week-designing GRID, with no idea where it is being used.
 *
 * Extracted from `app/program/[id]/week/week-designer.tsx` on 2026-09-09, when
 * Levi asked for the builder to be available during onboarding as well as on an
 * existing program. Two surfaces now show the same control:
 *
 *   - the program page, which saves through a server action and rebuilds;
 *   - the onboarding wizard, which serialises the template into the form so the
 *     program is built from the athlete's week the FIRST time, rather than being
 *     generated with the engine's week and immediately regenerated.
 *
 * Keeping this one component is the point. The session menu, the preset buttons,
 * the day layout and — most of all — the live validation are the tier's whole
 * value; two copies of them would drift, and the copy that drifted would be the
 * one telling an athlete which training rule they were breaking.
 *
 * It owns its grid state and reports outward through `onChange`. It deliberately
 * does NOT own saving: what "save" means differs completely between the two
 * callers, and pushing that in here is what would make it a third thing.
 */

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
  { label: "Swim", hint: "the engine picks the set", session: { kind: "swim" } },
  { label: "Brick", hint: "bike, then run", session: { kind: "brick" } },
  { label: "Bike", hint: "easy aerobic, no impact", session: { kind: "bike" } },
  { label: "Lift — full body", session: { kind: "lift", liftType: "full" } },
  { label: "Lift — upper", session: { kind: "lift", liftType: "upper" } },
  { label: "Lift — lower", session: { kind: "lift", liftType: "lower" } },
  {
    label: "Lift — power",
    hint: "the race's four stations",
    session: { kind: "lift", liftType: "power" },
  },
];

/**
 * The choices that make sense for THIS sport.
 *
 * Offering everything to everyone was fine while the designer served two station
 * sports; it stops being fine the moment a triathlete opens it and is offered
 * "Hybrid / stations", or a HYROX athlete is offered a swim the engine has
 * nowhere to put. A menu that offers work the sport cannot use is not a richer
 * menu, it is a way of authoring a week that quietly loses sessions.
 *
 * Filtering here rather than at the callsite because the grid is the only thing
 * that knows what a choice IS — `week-designer` and the onboarding wizard both
 * just pass the sport's own flags through.
 */
function choicesFor(opts: { includeHybrid: boolean; includeSwim: boolean }) {
  return CHOICES.filter((c) => {
    if (c.session.kind === "hybrid") return opts.includeHybrid;
    if (c.session.kind === "swim") return opts.includeSwim;
    // The race's four loaded stations. Meaningless without a station race to
    // load them from, so it travels with the hybrid rather than with the lifts.
    if (c.session.kind === "lift" && c.session.liftType === "power") return opts.includeHybrid;
    return true;
  });
}

const LIFT_LABEL: Record<NonNullable<TemplateSession["liftType"]>, string> = {
  full: "full body",
  upper: "upper",
  lower: "lower",
  power: "power",
};

export function sessionLabel(s: TemplateSession): string {
  if (s.kind === "hybrid") return "Hybrid";
  if (s.kind === "swim") return "Swim";
  if (s.kind === "brick") return "Brick · bike→run";
  if (s.kind === "bike") return "Bike";
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

/**
 * The size fields a session can carry, and what each one means.
 *
 * A run is asked for in MILES because that is the currency the week's budget is
 * kept in — but an athlete who thinks in minutes can type minutes and the
 * designer converts at that run type's own pace before storing, so the engine
 * only ever sees one currency. A bike is asked for in minutes because a ride has
 * no mileage in a station athlete's budget. A brick is asked for in both,
 * because a brick IS both.
 *
 * A lift and a hybrid take neither: a lift is a fixed hour and a hybrid's size
 * is the race's, not the athlete's.
 */
function sizeFieldsFor(s: TemplateSession): ("miles" | "minutes")[] {
  if (s.kind === "run") return ["miles"];
  if (s.kind === "bike") return ["minutes"];
  if (s.kind === "swim") return ["minutes"];
  if (s.kind === "brick") return ["minutes", "miles"];
  return [];
}

const SIZE_LABEL: Record<"miles" | "minutes", string> = { miles: "mi", minutes: "min" };

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

export default function WeekGrid({
  initial,
  context,
  includeHybrid,
  includeSwim = false,
  onChange,
}: {
  initial: WeekTemplate | null;
  context: TemplateContext;
  includeHybrid: boolean;
  /**
   * Whether this sport swims (triathlon, Levi 2026-09-11).
   *
   * Defaulted rather than required so the two existing callers keep compiling
   * unchanged — and because `false` is the truthful answer for every sport that
   * is not a triathlon, which is most of them.
   */
  includeSwim?: boolean;
  /** Called after every edit with the template and what the validator makes of
   *  it, so the caller can save it, serialise it, or gate its own submit. */
  onChange?: (template: WeekTemplate, issues: TemplateIssue[]) => void;
}) {
  /**
   * ⚠️ THESE TWO KEYS EXIST TO STOP AN INFINITE RENDER LOOP. Do not inline them.
   *
   * `trainingDays` used to be a bare `.filter()` — a fresh array on every render.
   * That was harmless while the grid and the save button lived in one component,
   * because nothing downstream compared identities. Extracting the grid on
   * 2026-09-09 made it fatal: a new `trainingDays` invalidates the `template`
   * memo, which invalidates the `issues` memo, which re-fires the `onChange`
   * effect, which calls the parent's `setState`, which re-renders us — forever.
   * The tab pegs a core and stops responding, and the symptom is not a crash or
   * a warning. It is that nothing on the page reacts: Levi reported it as "the
   * back link isn't working".
   *
   * So both memos hang off VALUE keys rather than object identity. That also
   * makes the component safe for a caller that builds its context inline — the
   * onboarding wizard passes `{ trainingDays: days }` straight from client
   * state, which is a new object every keystroke and would have reintroduced the
   * loop the moment it shipped.
   */
  const daysKey = context.trainingDays.join(",");
  const contextKey = [
    daysKey,
    context.peakMileage,
    context.weeklyHours,
    context.runningExp,
    context.prescribesRunning,
    context.prescribesHybrid,
  ].join("|");

  const trainingDays = useMemo(
    () => DAY_ORDER.filter((d) => daysKey.split(",").includes(d)),
    [daysKey],
  );

  // Memoized for the same reason `trainingDays` is: seven DayCards receive this,
  // and a fresh array each render is the identity churn the loop above was made
  // of. Both flags are booleans, so the dependency list is honest.
  const choices = useMemo(
    () => choicesFor({ includeHybrid, includeSwim }),
    [includeHybrid, includeSwim],
  );

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
  // Keyed by CONTENT (`contextKey`), not by the `context` object — see above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const issues = useMemo(() => validateTemplate(template, context), [template, contextKey]);
  const sessionCount = template.days.reduce((n, d) => n + d.sessions.length, 0);

  // In an effect, not in the handlers: the caller wants the template AFTER the
  // edit, and a handler only knows the value it is about to set.
  useEffect(() => {
    onChange?.(template, issues);
    // `onChange` is usually an inline arrow, so depending on it would fire this
    // every render. The template and issues are what the caller actually cares
    // about changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, issues]);

  /**
   * The single way the grid changes.
   *
   * Everything routes through here so that nothing can change without an undo
   * entry. `setSaved(false)` used to be called from inside the `setWeek`
   * updater, which React is free to run twice — a state setter inside a state
   * updater is a bug waiting for the day someone turns on StrictMode.
   */
  const mutate = (label: string, next: (w: Week) => Week) => {
    setHistory((h) => [...h, { week, label }].slice(-MAX_UNDO));
    setWeek(next);
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

  /**
   * Change a session's starting size.
   *
   * Goes through `mutate` like every other edit, so it lands in the undo history
   * — typing 12 where you meant 1.2 is exactly the mistake you want to take back
   * in one click, and it is the one edit here that is easy to make without
   * noticing.
   */
  const resize = (
    day: TrainingDayName,
    i: number,
    patch: { startMiles?: number; startMin?: number },
  ) => {
    const s = week[day]?.[i];
    if (!s) return;
    mutate(`resizing ${sessionLabel(s)}`, (w) => ({
      ...w,
      [day]: (w[day] ?? []).map((x, k) => {
        if (k !== i) return x;
        const next = { ...x, ...patch };
        // An emptied box means "you decide" again, not zero.
        if (patch.startMiles !== undefined && !Number.isFinite(patch.startMiles))
          delete next.startMiles;
        if (patch.startMin !== undefined && !Number.isFinite(patch.startMin)) delete next.startMin;
        return next;
      }),
    }));
  };

  const applyPreset = (goal: TemplateGoal) => {
    const t = suggestTemplate(goal, {
      trainingDays,
      includeHybrid,
      includeSwimBike: includeSwim,
      peakMileage: context.peakMileage,
    });
    const next = emptyWeek(trainingDays);
    for (const d of t.days) next[d.day] = [...d.sessions];
    const name = TEMPLATE_GOALS.find((g) => g.id === goal)?.label ?? "that preset";
    mutate(`“${name}”`, () => next);
  };

  const lastChange = history[history.length - 1];

  const undo = () => {
    if (!lastChange) return;
    setHistory((h) => h.slice(0, -1));
    setWeek(lastChange.week);
  };

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
              paces={context.runPaceMin}
              choices={choices}
              onAdd={(s) => addTo(day, s)}
              onRemove={(i) => removeFrom(day, i)}
              onResize={(i, patch) => resize(day, i, patch)}
            />
          ))}
        </div>
        <p className="text-xs text-zinc-500">
          Say what and where. Sizes are optional — leave one blank and the engine picks it from your
          mileage target. Anything you do set is where that session STARTS: the engine still ramps
          it week by week, still deloads and tapers it, and still holds it to the session time cap
          and the long run&apos;s ceiling.
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
    </div>
  );
}

function DayCard({
  day,
  sessions,
  issues,
  paces,
  choices,
  onAdd,
  onRemove,
  onResize,
}: {
  day: TrainingDayName;
  sessions: TemplateSession[];
  issues: TemplateIssue[];
  paces: TemplateContext["runPaceMin"];
  /** What this sport lets the athlete add. Computed once by the grid, because
   *  it is the same list on all seven days and rebuilding it per card would
   *  hand every card a new array on every render. */
  choices: typeof CHOICES;
  onAdd: (s: TemplateSession) => void;
  onRemove: (i: number) => void;
  onResize: (i: number, patch: { startMiles?: number; startMin?: number }) => void;
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
            className="flex flex-col gap-2 rounded-lg bg-zinc-100 px-3 py-2"
          >
            <div className="flex items-center justify-between text-sm">
              <span>{sessionLabel(s)}</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Remove ${sessionLabel(s)} from ${DAY_SHORT[day]}`}
                className="text-zinc-400 transition-colors hover:text-red-600"
              >
                ×
              </button>
            </div>
            {sizeFieldsFor(s).length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {sizeFieldsFor(s).map((field) => (
                  <SizeField
                    key={field}
                    session={s}
                    field={field}
                    day={day}
                    paces={paces}
                    onResize={(patch) => onResize(i, patch)}
                  />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {sessions.length < 2 &&
        (open ? (
          <div className="flex flex-col gap-1">
            {choices.map((c) => (
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

/**
 * One starting-size box.
 *
 * Uncontrolled-ish on purpose: the value comes from the session but the box is
 * free-typed, so a half-finished "1." does not get parsed to 1 and written back
 * under the athlete's fingers. Blank clears the size rather than storing zero —
 * "you decide" and "zero miles" are different instructions and only one of them
 * is meaningful.
 *
 * A RUN can be entered in minutes when the athlete's benchmarks gave us a pace
 * for that run type. The conversion happens here, once, and only miles are
 * stored — the engine should never have to guess which currency a number is in.
 */
function SizeField({
  session,
  field,
  day,
  paces,
  onResize,
}: {
  session: TemplateSession;
  field: "miles" | "minutes";
  day: TrainingDayName;
  paces: TemplateContext["runPaceMin"];
  onResize: (patch: { startMiles?: number; startMin?: number }) => void;
}) {
  const isRun = session.kind === "run";
  const pace = isRun ? paces?.[session.runType ?? "easy"] : undefined;
  const [asTime, setAsTime] = useState(false);

  const stored = field === "miles" ? session.startMiles : session.startMin;
  const canonical =
    asTime && pace !== undefined && stored !== undefined
      ? String(Math.round(stored * pace))
      : stored !== undefined
        ? String(stored)
        : "";

  /**
   * THE BOX KEEPS ITS OWN TEXT, AND THAT IS THE ONLY WAY A DECIMAL CAN BE TYPED.
   *
   * This was fully controlled from the stored number, which meant a keystroke had
   * to survive a round trip through `Number()` before it came back on screen —
   * and `Number("3.")` is `3`. So the moment you typed the decimal point it was
   * parsed away and the box re-rendered as "3". You could not enter 3.25 at all;
   * you could not enter any decimal at all. Levi reported it as "the mile input
   * needs to allow for up to 2 decimal points", and the second half of that is
   * true but the first half was worse than it sounded.
   *
   * So the input owns a DRAFT string. What the athlete typed stays exactly as
   * typed — "3.", "3.2", ".5" — while the parsed value goes up on every
   * keystroke. The effect below re-syncs only when the stored number stops
   * agreeing with the draft, which is what happens on an undo or a preset; it
   * deliberately does NOT fire when the parent merely echoes back the value this
   * box just sent, or the draft would be rewritten under the cursor.
   *
   * ⚠️ That last sentence is also the render-loop guard. Comparing NUMBERS rather
   * than strings is what keeps "3." from being replaced by "3" on the very next
   * render — and an effect that writes state on every render is exactly how this
   * component froze the page once already.
   */
  const [draft, setDraft] = useState(canonical);
  const [seen, setSeen] = useState(canonical);
  if (canonical !== seen) {
    // Adjusting state DURING RENDER, not in an effect. React documents this for
    // exactly this case and it re-renders before committing, so nothing flickers
    // — and `react-hooks/set-state-in-effect` is right to refuse the effect
    // version. An effect that writes state on every render is how this very
    // component froze the page on 2026-09-09; the lint that catches it only
    // started running the same day.
    setSeen(canonical);
    if (Number(draft) !== Number(canonical)) setDraft(canonical);
  }

  const commit = (raw: string) => {
    setDraft(raw);
    const n = Number(raw);
    const empty = raw.trim() === "" || !Number.isFinite(n) || n <= 0;
    if (field === "minutes") {
      onResize({ startMin: empty ? Number.NaN : Math.round(n) });
      return;
    }
    // Miles — converting from a typed TIME first when that is the unit shown.
    // The conversion result keeps two decimals even though the typed minutes
    // were whole: 25 minutes at 8:30/mi is 2.94 miles, and rounding that to 2.9
    // would lose distance the athlete never chose to give up.
    const miles = asTime && pace !== undefined && pace > 0 ? n / pace : n;
    onResize({ startMiles: empty ? Number.NaN : Math.round(miles * 100) / 100 });
  };

  const unit = field === "miles" && asTime ? "min" : SIZE_LABEL[field];
  const label = session.kind === "brick" ? (field === "minutes" ? "bike" : "run") : "starts at";

  return (
    <label className="flex items-center gap-1 text-xs text-zinc-500">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => commit(e.target.value)}
        aria-label={`${sessionLabel(session)} on ${DAY_SHORT[day]} — starting ${unit === "min" ? "time" : "distance"}`}
        placeholder="—"
        className="w-14 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-right text-xs text-zinc-900 focus:border-black focus:outline-none"
      />
      {/* Only a RUN can be given in either currency, and only when we know the
          pace to convert at. Everything else has exactly one honest unit. */}
      {field === "miles" && pace !== undefined ? (
        <button
          type="button"
          onClick={() => setAsTime((v) => !v)}
          className="rounded px-1 text-xs text-zinc-500 underline decoration-dotted hover:text-black"
          aria-label={`Switch to ${asTime ? "miles" : "minutes"}`}
        >
          {unit}
        </button>
      ) : (
        <span>{unit}</span>
      )}
    </label>
  );
}
