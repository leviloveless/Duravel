"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProgramWeek } from "@/lib/schemas";
import WeekNav from "./week-nav";

/**
 * One week at a time (Levi, 2026-08-25).
 *
 * The program view used to render all sixteen week cards in a single column —
 * the week chips jumped you down a page tall enough that finding anything meant
 * scrolling past everything else. This shows the week you asked for and hides
 * the rest.
 *
 * Three things it deliberately does NOT do:
 *
 *  - It does not drop the other weeks from the page. They stay mounted and
 *    hidden (`hidden print:block`), so printing or PDF-exporting still yields
 *    the WHOLE program the way it does today. Rendering only the active week
 *    would have been lighter and would have quietly broken that.
 *  - It does not compute which week is "current". That reads the clock, and the
 *    server's clock is UTC while the athlete's is not — so the server decides
 *    and passes `defaultWeek` down. See `currentWeekNumber`.
 *  - It does not push history entries. Selecting a week REPLACES the hash, so a
 *    reload or a shared link lands on the right week without burying the page
 *    under sixteen back-button steps.
 */

export interface WeekTabItem {
  week: ProgramWeek;
  content: React.ReactNode;
}

export default function WeekTabs({
  items,
  defaultWeek,
  footer,
}: {
  items: WeekTabItem[];
  /** The week to open on. Computed on the SERVER — see the note above. */
  defaultWeek: number;
  /** Rendered after the week area (the paywall CTA lives here). */
  footer?: React.ReactNode;
}) {
  const weeks = items.map((i) => i.week);
  const numbers = weeks.map((w) => w.weekNumber);
  const first = numbers[0] ?? 1;
  const [active, setActive] = useState(() => (numbers.includes(defaultWeek) ? defaultWeek : first));
  // A user-driven switch scrolls the week into view; hydration and deep links
  // must not, or landing on the page would yank you down it.
  const scrollOnNextRender = useRef(false);

  // `#week-N` still selects the week, so every link that used to scroll to one
  // keeps working — including the ones already in the wild.
  useEffect(() => {
    const fromHash = () => {
      const m = /^#week-(\d+)$/.exec(window.location.hash);
      if (!m) return;
      const n = Number(m[1]);
      if (numbers.includes(n)) setActive(n);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!scrollOnNextRender.current) return;
    scrollOnNextRender.current = false;
    // "nearest" is a no-op when the card is already on screen, which it usually
    // is — this only rescues the case where you switched from far down a week.
    document.getElementById(`week-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const select = useCallback((n: number) => {
    scrollOnNextRender.current = true;
    setActive(n);
    window.history.replaceState(null, "", `#week-${n}`);
  }, []);

  const index = numbers.indexOf(active);
  const prev = index > 0 ? numbers[index - 1] : undefined;
  const next = index >= 0 && index < numbers.length - 1 ? numbers[index + 1] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <WeekNav weeks={weeks} active={active} onSelect={select} />

      <div className="flex flex-col gap-6">
        {items.map((it) => (
          <div
            key={it.week.weekNumber}
            className={it.week.weekNumber === active ? undefined : "hidden print:block"}
          >
            {it.content}
          </div>
        ))}
      </div>

      {/* Sequential reading: the way through a program is one week after another. */}
      {(prev !== undefined || next !== undefined) && (
        <div className="flex items-center justify-between gap-3 print:hidden">
          <StepButton weekNumber={prev} direction="prev" onSelect={select} />
          <span className="text-xs text-zinc-400">
            Week {active} of {numbers.length}
          </span>
          <StepButton weekNumber={next} direction="next" onSelect={select} />
        </div>
      )}

      {footer}
    </div>
  );
}

function StepButton({
  weekNumber,
  direction,
  onSelect,
}: {
  weekNumber: number | undefined;
  direction: "prev" | "next";
  onSelect: (n: number) => void;
}) {
  if (weekNumber === undefined) return <span aria-hidden />;
  const label = direction === "prev" ? `← Week ${weekNumber}` : `Week ${weekNumber} →`;
  return (
    <button
      type="button"
      onClick={() => onSelect(weekNumber)}
      className="rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
    >
      {label}
    </button>
  );
}
