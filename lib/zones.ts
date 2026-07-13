/**
 * Heart-rate zone model (Review #3).
 *
 * Replaces the flat `220 − age` + %HRmax scheme with:
 *   1. a sex-specific, better-calibrated max-HR estimate, and
 *   2. a "best-available" zone anchoring cascade that uses the most
 *      individualized data the athlete has provided:
 *        thresholdHr → %LTHR (Friel)  >  restingHr → %HRR (Karvonen)  >  %HRmax
 *
 * Every method ultimately returns zone bounds expressed as FRACTIONS OF MAX HR,
 * so the existing display path (bpm = fraction × maxHR) and any custom
 * user-set %-of-max bands keep working unchanged — only the fractions differ
 * per method. (For HRR the fraction folds in resting HR; for LTHR the maxHR
 * cancels out, leaving fraction×maxHR = %LTHR × thresholdHr.)
 */

export type Zone = 1 | 2 | 3 | 4 | 5;
export type Sex = "male" | "female" | "other";

/** One zone's [low, high] bounds as fractions (0–1) of the reference HR. */
export type ZoneBand = { low: number; high: number };
export type ZoneBandMap = Record<Zone, ZoneBand>;

export const ZONE_LABEL: Record<Zone, string> = {
  1: "Recovery / very easy",
  2: "Easy aerobic / base building",
  3: "Moderate aerobic / tempo",
  4: "Threshold / lactate threshold",
  5: "Max effort / VO2 max",
};

/** Legacy export (kept for compatibility): zone labels + rough %HRmax bounds. */
export const ZONE_RANGES: Record<Zone, { min: number; max: number; label: string }> = {
  1: { min: 0, max: 0.7, label: ZONE_LABEL[1] },
  2: { min: 0.7, max: 0.8, label: ZONE_LABEL[2] },
  3: { min: 0.8, max: 0.87, label: ZONE_LABEL[3] },
  4: { min: 0.87, max: 0.93, label: ZONE_LABEL[4] },
  5: { min: 0.93, max: 1.0, label: ZONE_LABEL[5] },
};

/** Target weekly cardio zone distribution, per spec §3. */
export const TARGET_ZONE_DISTRIBUTION: Record<Zone, number> = {
  1: 20,
  2: 60,
  3: 10,
  4: 5,
  5: 5,
};

// --- band tables (each expressed within its OWN reference) ------------------

/**
 * %HRmax bands (fraction of max HR). Corrected from the old scheme so genuine
 * easy aerobic running (~72–80% HRmax) reads as Zone 2 rather than being
 * mislabeled Zone 3. Used only when neither threshold nor resting HR is known.
 */
export const ZONE_BANDS_HRMAX: ZoneBandMap = {
  1: { low: 0, high: 0.7 },
  2: { low: 0.7, high: 0.8 },
  3: { low: 0.8, high: 0.87 },
  4: { low: 0.87, high: 0.93 },
  5: { low: 0.93, high: 1.0 },
};

/** %HRR (Karvonen) bands — fraction of heart-rate reserve (max − rest). */
export const ZONE_BANDS_HRR: ZoneBandMap = {
  1: { low: 0, high: 0.6 },
  2: { low: 0.6, high: 0.7 },
  3: { low: 0.7, high: 0.8 },
  4: { low: 0.8, high: 0.9 },
  5: { low: 0.9, high: 1.0 },
};

/**
 * %LTHR (Friel) bands — fraction of lactate-threshold HR, with threshold HR at
 * the Zone-4/5 boundary. Friel's 5a/5b/5c are collapsed into a single Zone 5.
 */
export const ZONE_BANDS_LTHR: ZoneBandMap = {
  1: { low: 0, high: 0.85 },
  2: { low: 0.85, high: 0.89 },
  3: { low: 0.9, high: 0.94 },
  4: { low: 0.95, high: 1.0 },
  5: { low: 1.0, high: 1.06 },
};

// --- max heart rate ---------------------------------------------------------

const DEFAULT_AGE = 30;

/**
 * Estimate max HR. Priority: explicit tested value → sex-specific age formula.
 *   female  → Gulati 206 − 0.88·age
 *   other/  → Tanaka 208 − 0.70·age   (both better than the old 220 − age)
 *   male
 */
export function maxHeartRate(age?: number, sex?: Sex, override?: number): number {
  if (typeof override === "number" && override > 0) return Math.round(override);
  const a = typeof age === "number" && age > 0 ? age : DEFAULT_AGE;
  if (sex === "female") return Math.round(206 - 0.88 * a);
  return Math.round(208 - 0.7 * a);
}

// --- the model resolver -----------------------------------------------------

export type ZoneAnchor = "custom" | "lthr" | "hrr" | "hrmax";

export interface HrModelInput {
  age?: number;
  sex?: Sex;
  /** Tested max HR override. */
  maxHr?: number;
  restingHr?: number;
  thresholdHr?: number;
  /** User-set custom bands as fractions of max HR (highest priority). */
  customBands?: ZoneBandMap;
}

export interface HrModel {
  method: ZoneAnchor;
  maxHR: number;
  restingHr?: number;
  thresholdHr?: number;
  /** Zone bounds as fractions of MAX HR, so bpm = fraction × maxHR downstream. */
  bands: ZoneBandMap;
  /** Human-readable description of the anchoring method. */
  label: string;
}

const METHOD_LABEL: Record<ZoneAnchor, string> = {
  custom: "your custom %-of-max heart-rate zones",
  lthr: "% of lactate-threshold HR (Friel)",
  hrr: "% of heart-rate reserve (Karvonen)",
  hrmax: "% of max HR",
};

/** Convert %HRR bands → fraction-of-max, folding in resting HR. */
function hrrToFractionOfMax(maxHR: number, restingHr: number): ZoneBandMap {
  const reserve = maxHR - restingHr;
  const conv = (p: number) => (restingHr + p * reserve) / maxHR;
  const out = {} as ZoneBandMap;
  (Object.keys(ZONE_BANDS_HRR) as unknown as Zone[]).forEach((z) => {
    out[z] = { low: conv(ZONE_BANDS_HRR[z].low), high: conv(ZONE_BANDS_HRR[z].high) };
  });
  return out;
}

/** Convert %LTHR bands → fraction-of-max (maxHR cancels in the display multiply). */
function lthrToFractionOfMax(maxHR: number, thresholdHr: number): ZoneBandMap {
  const conv = (p: number) => Math.min(1, (p * thresholdHr) / maxHR);
  const out = {} as ZoneBandMap;
  (Object.keys(ZONE_BANDS_LTHR) as unknown as Zone[]).forEach((z) => {
    out[z] = { low: conv(ZONE_BANDS_LTHR[z].low), high: conv(ZONE_BANDS_LTHR[z].high) };
  });
  // Zone 1 opens at 0 and Zone 5 tops out at max so the display renders "<x"/"x+".
  out[1].low = 0;
  out[5].high = 1;
  return out;
}

/**
 * Resolve the best-available HR zone model for an athlete.
 * Cascade: explicit custom bands → LTHR (thresholdHr) → HRR (restingHr) → HRmax.
 */
export function resolveHrModel(input: HrModelInput): HrModel {
  const maxHR = maxHeartRate(input.age, input.sex, input.maxHr);

  if (input.customBands) {
    return { method: "custom", maxHR, bands: input.customBands, label: METHOD_LABEL.custom };
  }
  if (typeof input.thresholdHr === "number" && input.thresholdHr > 0) {
    return {
      method: "lthr",
      maxHR,
      thresholdHr: input.thresholdHr,
      bands: lthrToFractionOfMax(maxHR, input.thresholdHr),
      label: METHOD_LABEL.lthr,
    };
  }
  if (typeof input.restingHr === "number" && input.restingHr > 0 && input.restingHr < maxHR) {
    return {
      method: "hrr",
      maxHR,
      restingHr: input.restingHr,
      bands: hrrToFractionOfMax(maxHR, input.restingHr),
      label: METHOD_LABEL.hrr,
    };
  }
  return { method: "hrmax", maxHR, bands: ZONE_BANDS_HRMAX, label: METHOD_LABEL.hrmax };
}

/** The bpm range for a zone under a resolved model. */
export function zoneBpmRange(model: HrModel, zone: Zone): { min: number; max: number } {
  const b = model.bands[zone];
  return { min: Math.round(b.low * model.maxHR), max: Math.round(b.high * model.maxHR) };
}
