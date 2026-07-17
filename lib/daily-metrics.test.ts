import { describe, it, expect } from "vitest";
import { weeklyRecoveryAverages } from "./daily-metrics";
import type { DailyMetricRow } from "@/lib/supabase/queries";

// Program starts Mon 2026-07-06 → week 1 = 07-06..07-12, week 2 = 07-13..07-19.
const START = "2026-07-06";

describe("weeklyRecoveryAverages", () => {
  it("averages resting HR and HRV within each program week", () => {
    const rows: DailyMetricRow[] = [
      { date: "2026-07-06", resting_hr: 50, hrv: 80 },
      { date: "2026-07-08", resting_hr: 54, hrv: 70 },
      { date: "2026-07-13", resting_hr: 48, hrv: 90 },
    ];
    const m = weeklyRecoveryAverages(rows, START, 12);
    expect(m.get(1)).toEqual({ restingHr: 52, hrv: 75 }); // (50+54)/2, (80+70)/2
    expect(m.get(2)).toEqual({ restingHr: 48, hrv: 90 });
  });

  it("averages HR and HRV independently (a day may have only one)", () => {
    const rows: DailyMetricRow[] = [
      { date: "2026-07-06", resting_hr: 50, hrv: null },
      { date: "2026-07-07", resting_hr: null, hrv: 60 },
    ];
    expect(weeklyRecoveryAverages(rows, START, 12).get(1)).toEqual({ restingHr: 50, hrv: 60 });
  });

  it("ignores readings outside the program's weeks", () => {
    const rows: DailyMetricRow[] = [
      { date: "2026-06-01", resting_hr: 99, hrv: 10 }, // before week 1
      { date: "2026-07-06", resting_hr: 50, hrv: 80 },
    ];
    const m = weeklyRecoveryAverages(rows, START, 12);
    expect(m.has(1)).toBe(true);
    expect([...m.keys()]).toEqual([1]);
  });
});
