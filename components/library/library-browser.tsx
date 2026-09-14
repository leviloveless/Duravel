"use client";

import { useMemo, useState } from "react";
import {
  DISCIPLINES,
  DISCIPLINE_LABEL,
  GOALS,
  GOAL_BLURB,
  GOAL_COLOR_VAR,
  GOAL_LABEL,
  type Discipline,
  type Goal,
  type LibraryWorkout,
} from "@/lib/library/types";

/**
 * Filter + grid for the workout library.
 *
 * Two independent filters, each with an "All". Goal chips carry their colour
 * swatch AND their name — identity is never colour alone, which matters here
 * because two of the seven goals are only reliably separable by their label for
 * a red-green colourblind reader.
 */
export default function LibraryBrowser({
  workouts,
  initialGoal = null,
}: {
  workouts: readonly LibraryWorkout[];
  /** Preselected from `?goal=` — how the limiter diagnostic hands off to here. */
  initialGoal?: Goal | null;
}) {
  const [discipline, setDiscipline] = useState<Discipline | "all">("all");
  const [goal, setGoal] = useState<Goal | "all">(initialGoal ?? "all");

  const shown = useMemo(
    () =>
      workouts.filter(
        (w) =>
          (discipline === "all" || w.discipline === discipline) &&
          (goal === "all" || w.goal === goal),
      ),
    [workouts, discipline, goal],
  );

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
      active
        ? "border-zinc-900 bg-zinc-900 text-white"
        : "border-line-strong bg-white hover:border-accent"
    }`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 shrink-0 font-mono text-[10px] tracking-[0.12em] text-zinc-500 uppercase">
            Discipline
          </span>
          <button onClick={() => setDiscipline("all")} className={chip(discipline === "all")}>
            All
          </button>
          {DISCIPLINES.map((d) => (
            <button key={d} onClick={() => setDiscipline(d)} className={chip(discipline === d)}>
              {DISCIPLINE_LABEL[d]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 shrink-0 font-mono text-[10px] tracking-[0.12em] text-zinc-500 uppercase">
            Goal
          </span>
          <button onClick={() => setGoal("all")} className={chip(goal === "all")}>
            All
          </button>
          {GOALS.map((g) => (
            <button key={g} onClick={() => setGoal(g)} className={chip(goal === g)}>
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ background: GOAL_COLOR_VAR[g] }}
              />
              {GOAL_LABEL[g]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-zinc-500">
        <span>
          <b className="text-zinc-900">{shown.length}</b> of {workouts.length} sessions
        </span>
        {goal !== "all" && <span className="text-zinc-600">— {GOAL_BLURB[goal]}</span>}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nothing matches that combination. Try widening the discipline — not every goal is trained
          on every apparatus.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
          {shown.map((w) => (
            <article
              key={w.id}
              className="border-line flex flex-col gap-2.5 rounded-xl border bg-white p-4"
            >
              <h3 className="text-base leading-snug font-semibold">{w.name}</h3>

              <span className="border-line inline-flex w-fit items-center gap-1.5 rounded-full border bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-zinc-700">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: GOAL_COLOR_VAR[w.goal] }}
                />
                {GOAL_LABEL[w.goal]}
              </span>

              <div className="flex flex-wrap gap-2 font-mono text-[11px] tracking-wide text-zinc-500 uppercase">
                <span>{w.minutes} min</span>
                <span aria-hidden>·</span>
                <span>{DISCIPLINE_LABEL[w.discipline]}</span>
                <span aria-hidden>·</span>
                <span>{w.phase} phase</span>
              </div>

              <ol className="border-line flex flex-col gap-0.5 rounded-lg border bg-zinc-50 px-3 py-2.5 text-[13px] leading-relaxed text-zinc-700">
                {w.structure.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>

              <p className="text-xs leading-relaxed text-zinc-500">
                <b className="font-semibold text-zinc-700">Why:</b> {w.why}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
