/**
 * Taper insertion (spec §6).
 *
 * Tapers override the standard microcycle, working backward from each race:
 *   - A race: 2 weeks, −30% then −30% again (cumulative ≈ −51% from peak)
 *   - B race: 1 week,  −40% (a deload-equivalent)
 *   - C race: 3–4 days, −40% over those days ≈ −20% across the week
 *
 * Cuts reduce from the pre-taper progression level (the week before the taper
 * window). For multi-race programs, each race's taper is applied independently
 * and the normal microcycle progression resumes on the weeks after it — the
 * final A race sits at the end of the program, so its taper coincides with the
 * Taper mesocycle and forms the program's peak.
 */

import type { EngineRace, MicroWeekType, RacePriorityName } from "./types";
import { A_TAPER_WEEK_FACTOR, B_TAPER_FACTOR, C_TAPER_FACTOR } from "./volume";
import { taperWeeksForPriority } from "./mesocycles";

export interface TaperableWeeks {
  mileage: number[];
  cardioMinutes: number[];
  microLabels: MicroWeekType[];
}

export interface TaperResult extends TaperableWeeks {
  /** 1-based week number → race info, for weeks that host a race. */
  raceWeeks: Map<number, { priority: RacePriorityName; date?: string }>;
}

/**
 * Apply all race tapers over the base progression. `base` arrays are the
 * un-tapered per-week targets (length durationWeeks). `basis`, when provided,
 * supplies the peak ("held") volume the cuts measure from — so a taper always
 * reduces from true peak volume, never from a deload trough. Returns fresh
 * arrays; inputs are not mutated.
 */
export function applyTapers(
  base: TaperableWeeks,
  races: EngineRace[],
  basis?: { mileage: number[]; cardioMinutes: number[] },
): TaperResult {
  const mileage = [...base.mileage];
  const cardioMinutes = [...base.cardioMinutes];
  const microLabels = [...base.microLabels];
  const raceWeeks = new Map<number, { priority: RacePriorityName; date?: string }>();

  // Reference the held peak progression for the pre-taper basis so stacked
  // reductions always measure from true peak volume, not an already-cut week.
  const baseMileage = basis?.mileage ?? base.mileage;
  const baseCardio = basis?.cardioMinutes ?? base.cardioMinutes;

  for (const race of races) {
    const w = race.weekNumber; // 1-based
    if (w < 1 || w > mileage.length) continue;

    const len = taperWeeksForPriority(race.priority);
    const raceIdx = w - 1; // 0-based index of the race week
    const startIdx = raceIdx - (len - 1); // first taper-window index
    const preIdx = startIdx - 1; // week just before the taper begins

    const preMileage = preIdx >= 0 ? baseMileage[preIdx] : baseMileage[0];
    const preCardio = preIdx >= 0 ? baseCardio[preIdx] : baseCardio[0];

    if (race.priority === "A" && len === 2) {
      setWeek(mileage, cardioMinutes, microLabels, startIdx, preMileage * A_TAPER_WEEK_FACTOR, preCardio * A_TAPER_WEEK_FACTOR, "taper");
      setWeek(mileage, cardioMinutes, microLabels, raceIdx, preMileage * A_TAPER_WEEK_FACTOR * A_TAPER_WEEK_FACTOR, preCardio * A_TAPER_WEEK_FACTOR * A_TAPER_WEEK_FACTOR, "race");
    } else {
      const factor = race.priority === "B" ? B_TAPER_FACTOR : race.priority === "C" ? C_TAPER_FACTOR : B_TAPER_FACTOR;
      // Any leading taper-window weeks (none for len 1) get the flat cut too.
      for (let idx = startIdx; idx < raceIdx; idx++) {
        setWeek(mileage, cardioMinutes, microLabels, idx, preMileage * factor, preCardio * factor, "taper");
      }
      setWeek(mileage, cardioMinutes, microLabels, raceIdx, preMileage * factor, preCardio * factor, "race");
    }

    raceWeeks.set(w, { priority: race.priority, date: race.date });
  }

  return { mileage, cardioMinutes, microLabels, raceWeeks };
}

function setWeek(
  mileage: number[],
  cardio: number[],
  labels: MicroWeekType[],
  idx: number,
  mi: number,
  ca: number,
  label: MicroWeekType,
): void {
  if (idx < 0 || idx >= mileage.length) return;
  mileage[idx] = Math.round(mi * 10) / 10;
  cardio[idx] = Math.round(ca);
  labels[idx] = label;
}
