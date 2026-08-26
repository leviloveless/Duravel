"use client";

import type { ProgramWeek } from "@/lib/schemas";
import { PHASE_COLORS } from "./format";

/**
 * Sticky week picker.
 *
 * These chips used to be plain `#week-N` anchors that scrolled a very long page.
 * The page now shows ONE week at a time, so they select instead of scrolling —
 * same chips, same phase colouring, different job.
 */
export default function WeekNav({
  weeks,
  active,
  onSelect,
}: {
  weeks: ProgramWeek[];
  active: number;
  onSelect: (weekNumber: number) => void;
}) {
  return (
    <nav className="sticky top-0 z-10 -mx-2 border-b border-zinc-100 bg-white/90 px-2 py-2 backdrop-blur print:hidden">
      <div role="tablist" aria-label="Program weeks" className="flex gap-1.5 overflow-x-auto">
        {weeks.map((w) => {
          const on = w.weekNumber === active;
          const tone = w.raceDay
            ? "border-red-300 bg-red-50 text-red-700"
            : `${PHASE_COLORS[w.phase].border} text-zinc-700`;
          return (
            <button
              key={w.weekNumber}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`week-${w.weekNumber}`}
              onClick={() => onSelect(w.weekNumber)}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-medium transition-colors ${
                on ? "border-black bg-black text-white" : `${tone} hover:bg-zinc-50`
              }`}
              title={`Week ${w.weekNumber}`}
            >
              {w.weekNumber}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
