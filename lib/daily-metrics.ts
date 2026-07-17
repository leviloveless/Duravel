/**
 * Roll up daily resting-HR / HRV readings into a per-program-week average
 * (Tasks addition #7). Week alignment matches components/program/format.ts
 * (`weekStartDate` / `mondayOf`): week 1 is the Monday-anchored week containing
 * the program start date, and each subsequent week is the next Mon–Sun block.
 */
import type { DailyMetricRow } from "@/lib/supabase/queries";

export interface RecoveryAvg {
  restingHr: number | null;
  hrv: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Monday (local) on or before the given date. */
function mondayOf(date: Date): Date {
  const weekdayFromMon = (date.getDay() + 6) % 7;
  const r = new Date(date);
  r.setDate(date.getDate() - weekdayFromMon);
  return r;
}

/**
 * Average resting HR + HRV per program week. Days outside the program's weeks
 * are ignored; a week with no readings is simply absent from the map. HR and HRV
 * are averaged independently, so a day with only one of the two still counts.
 */
export function weeklyRecoveryAverages(
  rows: DailyMetricRow[],
  startISO: string,
  durationWeeks: number,
): Map<number, RecoveryAvg> {
  const wk1Monday = mondayOf(parseISODate(startISO)).getTime();
  const acc = new Map<number, { hrSum: number; hrN: number; hrvSum: number; hrvN: number }>();

  for (const r of rows) {
    const monday = mondayOf(parseISODate(r.date)).getTime();
    const week = Math.floor((monday - wk1Monday) / (7 * MS_PER_DAY)) + 1;
    if (week < 1 || week > durationWeeks) continue;
    const a = acc.get(week) ?? { hrSum: 0, hrN: 0, hrvSum: 0, hrvN: 0 };
    if (typeof r.resting_hr === "number") {
      a.hrSum += r.resting_hr;
      a.hrN += 1;
    }
    if (typeof r.hrv === "number") {
      a.hrvSum += r.hrv;
      a.hrvN += 1;
    }
    acc.set(week, a);
  }

  const out = new Map<number, RecoveryAvg>();
  for (const [week, a] of acc) {
    out.set(week, {
      restingHr: a.hrN > 0 ? Math.round(a.hrSum / a.hrN) : null,
      hrv: a.hrvN > 0 ? Math.round((a.hrvSum / a.hrvN) * 10) / 10 : null,
    });
  }
  return out;
}
