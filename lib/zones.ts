/**
 * Heart rate zone calculations.
 * Spec §3: max HR = 220 - age (or user-entered override).
 */

export type Zone = 1 | 2 | 3 | 4 | 5;

export const ZONE_RANGES: Record<Zone, { min: number; max: number; label: string }> = {
  1: { min: 0, max: 0.6, label: "Recovery / very easy" },
  2: { min: 0.6, max: 0.7, label: "Easy aerobic / base building" },
  3: { min: 0.7, max: 0.8, label: "Moderate aerobic / tempo" },
  4: { min: 0.8, max: 0.9, label: "Threshold / lactate threshold" },
  5: { min: 0.9, max: 1.0, label: "Max effort / VO2 max" },
};

/** Target weekly cardio zone distribution, per spec §3. */
export const TARGET_ZONE_DISTRIBUTION: Record<Zone, number> = {
  1: 20,
  2: 60,
  3: 10,
  4: 5,
  5: 5,
};

export function maxHeartRate(age: number): number {
  return 220 - age;
}

export function zoneBpmRange(age: number, zone: Zone): { min: number; max: number } {
  const hrMax = maxHeartRate(age);
  const { min, max } = ZONE_RANGES[zone];
  return { min: Math.round(hrMax * min), max: Math.round(hrMax * max) };
}
