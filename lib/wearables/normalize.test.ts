import { describe, it, expect } from "vitest";
import { normalizeDailyForDate, normalizeDailySeries, type DailyMetricSource } from "./normalize";

const src = (o: Partial<DailyMetricSource> & Pick<DailyMetricSource, "provider">): DailyMetricSource => ({
  date: o.date ?? "2026-07-01",
  provider: o.provider,
  restingHr: o.restingHr ?? null,
  hrv: o.hrv ?? null,
  sleepScore: o.sleepScore ?? null,
  sleepTotalMin: o.sleepTotalMin ?? null,
  readinessScore: o.readinessScore ?? null,
  respiratoryRate: o.respiratoryRate ?? null,
  vo2max: o.vo2max ?? null,
});

describe("normalizeDailyForDate", () => {
  it("prefers the higher-priority source per metric", () => {
    const rows = [
      src({ provider: "apple_health", restingHr: 55, hrv: 40 }),
      src({ provider: "oura", restingHr: 52, hrv: 65 }), // oura outranks apple_health
    ];
    const m = normalizeDailyForDate(rows)!;
    expect(m.restingHr).toBe(52);
    expect(m.hrv).toBe(65);
    expect(m.sources.restingHr).toBe("oura");
    expect(m.sources.hrv).toBe("oura");
  });
  it("falls back to a lower-priority source when the top one lacks that metric", () => {
    const rows = [
      src({ provider: "oura", restingHr: 52, hrv: null }), // oura has RHR only
      src({ provider: "apple_health", hrv: 48, vo2max: 51 }), // HK provides HRV + vo2max
    ];
    const m = normalizeDailyForDate(rows)!;
    expect(m.restingHr).toBe(52);
    expect(m.sources.restingHr).toBe("oura");
    expect(m.hrv).toBe(48);
    expect(m.sources.hrv).toBe("apple_health");
    expect(m.vo2max).toBe(51);
  });
  it("returns null for no rows", () => {
    expect(normalizeDailyForDate([])).toBeNull();
  });
});

describe("normalizeDailySeries", () => {
  it("merges per-date and returns newest-first", () => {
    const rows = [
      src({ provider: "oura", date: "2026-07-01", hrv: 60 }),
      src({ provider: "whoop", date: "2026-07-01", hrv: 70 }),
      src({ provider: "oura", date: "2026-07-02", hrv: 62 }),
    ];
    const series = normalizeDailySeries(rows);
    expect(series.map((s) => s.date)).toEqual(["2026-07-02", "2026-07-01"]);
    // Oura(5) outranks whoop(4) on 07-01
    expect(series[1]!.hrv).toBe(60);
  });
});
