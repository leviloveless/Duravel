/**
 * UI-facing copy + summary for the weekly-time-budget feature (volume-vs-
 * intensity research). Shared by the program-page TimeBudgetCard; the onboarding
 * form and the /science explorer carry their own copies today and can be
 * migrated to this module later.
 *
 * This is display/marketing text + a planned-load estimate — NOT engine logic
 * (that lives in lib/engine/time-budget.ts).
 */
import type { ProgramData, WeeklyHoursBand } from "@/lib/schemas";

export const BUDGET_LABEL: Record<WeeklyHoursBand, string> = {
  h0_5: "0–5 hours / week",
  h5_10: "5–10 hours / week",
  h10_20: "10–20 hours / week",
  h20_30: "20–30 hours / week",
  h30_40: "30–40 hours / week",
};

/** Qualitative intensity emphasis for the budget (the research framing). */
export const BAND_EMPHASIS: Record<WeeklyHoursBand, string> = {
  h0_5: "Threshold-leaning",
  h5_10: "Pyramidal",
  h10_20: "Pyramidal → polarized",
  h20_30: "Polarized",
  h30_40: "Strongly polarized",
};

export interface BudgetCopy {
  level: string;
  tradeoff: string;
}

const GENERIC: Record<WeeklyHoursBand, BudgetCopy> = {
  h0_5: { level: "Time-crunched", tradeoff: "Concentrated, higher-intensity work — efficient, but limits aerobic-base depth." },
  h5_10: { level: "Committed amateur", tradeoff: "A well-rounded base with room for quality sessions." },
  h10_20: { level: "Advanced / sub-elite", tradeoff: "Full base plus durability; little left on the table." },
  h20_30: { level: "Elite / full-time", tradeoff: "Maximal aerobic depth; returns start to diminish." },
  h30_40: { level: "Pro peak-block", tradeoff: "Camp-level volume; not sustainable long-term for most." },
};

const COPY: Record<string, Record<WeeklyHoursBand, BudgetCopy>> = {
  hyrox: {
    h0_5: { level: "Recreational; competitive Open finisher", tradeoff: "Builds VO₂max, threshold & station efficiency; gives up running durability and aerobic-base depth." },
    h5_10: { level: "Advanced age-grouper; Pro-qualifier attainable", tradeoff: "Adds race-specific durability; sacrifices only the last few % of aerobic base." },
    h10_20: { level: "Elite / Pro", tradeoff: "Full durability, aerobic base and race simulation; sacrifices little." },
    h20_30: { level: "Full-time Pro only", tradeoff: "Maximal durability; returns diminish and impact-injury risk becomes the limiter." },
    h30_40: { level: "Pro peak-block only; not sustainable", tradeoff: "No added benefit beyond 20–30 h for most; camp/peak use only." },
  },
  deka_fit: {
    h0_5: { level: "Recreational → competitive", tradeoff: "Builds glycolytic power, zone efficiency & VO₂max; little lost for FIT." },
    h5_10: { level: "Competitive age-grouper", tradeoff: "Race-specific power-endurance + aerobic support; gives up back-end aerobic base." },
    h10_20: { level: "Elite", tradeoff: "Everything DEKA FIT rewards; sacrifices little." },
    h20_30: { level: "Over-prescribed for DEKA; Pro only", tradeoff: "Aerobic ceiling well past DEKA's demands; strong diminishing returns." },
    h30_40: { level: "Not recommended for DEKA", tradeoff: "Volume exceeds event demand." },
  },
  deka_mile: {
    h0_5: { level: "Recreational → competitive", tradeoff: "Power & speed emphasis; a short, sharp event needs little aerobic volume." },
    h5_10: { level: "Competitive → elite", tradeoff: "Ample for MILE's power-endurance demands." },
    h10_20: { level: "Elite (beyond MILE's needs)", tradeoff: "More aerobic volume than the event rewards." },
    h20_30: { level: "Over-prescribed for MILE", tradeoff: "Diminishing returns." },
    h30_40: { level: "Not recommended", tradeoff: "Volume far exceeds event demand." },
  },
  deka_strong: {
    h0_5: { level: "Recreational → competitive (fully sufficient)", tradeoff: "Strength-endurance & glycolytic power; no running, minimal aerobic volume needed." },
    h5_10: { level: "Elite", tradeoff: "More than enough for a ~10–14 min strength-endurance sprint." },
    h10_20: { level: "Over-prescribed for STRONG", tradeoff: "Excess aerobic volume for the event." },
    h20_30: { level: "Not recommended", tradeoff: "Volume far exceeds event demand." },
    h30_40: { level: "Not recommended", tradeoff: "Volume far exceeds event demand." },
  },
  tri_olympic: {
    h0_5: { level: "Recreational; sprint-focused", tradeoff: "VO₂max, threshold & race pace; gives up aerobic base and swim-technique volume." },
    h5_10: { level: "Competitive age-grouper", tradeoff: "Competitive readiness; sacrifices only marginal base." },
    h10_20: { level: "Sub-elite / elite", tradeoff: "Base, economy, threshold & durability; sacrifices little." },
    h20_30: { level: "Elite / Pro", tradeoff: "Elite aerobic depth; diminishing returns for Olympic distance." },
    h30_40: { level: "Pro peak-block only", tradeoff: "No Olympic-specific return beyond 20–30 h." },
  },
  tri_70_3: {
    h0_5: { level: "Survival-only; back-of-pack finisher", tradeoff: "Threshold/VO₂max & finishing fitness; gives up durability, fat oxidation, fuelling practice & run robustness." },
    h5_10: { level: "Competitive age-grouper", tradeoff: "Credible mid-pack 70.3; sacrifices late-race durability depth." },
    h10_20: { level: "Kona-70.3 qualifier / elite", tradeoff: "Durability, fat oxidation, GI tolerance & competitive readiness; sacrifices little." },
    h20_30: { level: "Elite / Pro", tradeoff: "Elite durability and metabolic depth; approaching diminishing returns." },
    h30_40: { level: "Pro only", tradeoff: "Marginal returns over 20–30 h; recovery-support dependent." },
  },
  tri_140_6: {
    h0_5: { level: "Not advised except to finish", tradeoff: "Central fitness only; sacrifices nearly all durability, fuelling & structural prep — high blow-up/injury risk." },
    h5_10: { level: "Determined age-grouper; execution-dependent", tradeoff: "A realistic finish; sacrifices durability depth, GI robustness & injury margin." },
    h10_20: { level: "Kona qualifier / strong age-grouper", tradeoff: "Durability, fat oxidation & GI tolerance — genuine competitiveness; near the amateur optimum." },
    h20_30: { level: "Pro / full-time athlete", tradeoff: "Maximal durability and metabolic depth for 8 h+ racing; overtraining risk without full-time recovery." },
    h30_40: { level: "Pro peak-block only", tradeoff: "Volume-gated ceiling for the longest events; net-negative without pro recovery infrastructure." },
  },
  general_fitness: {
    h0_5: { level: "Time-crunched", tradeoff: "Efficient, higher-intensity mix; comfortably hits health & fitness floors." },
    h5_10: { level: "Well-rounded", tradeoff: "Comfortable balance of strength and cardio." },
    h10_20: { level: "High-volume enthusiast", tradeoff: "Plenty of room for both emphases." },
    h20_30: { level: "Very high volume", tradeoff: "More than most general-fitness goals require." },
    h30_40: { level: "Athlete-level volume", tradeoff: "Beyond general-fitness needs." },
  },
};

export function getBudgetCopy(sport: string, band: WeeklyHoursBand): BudgetCopy {
  return (COPY[sport] ?? GENERIC)[band];
}

// --- planned-load estimate from the generated program -----------------------

/** session-RPE (CR-10) anchors per 5-zone, used to estimate planned weekly load. */
const ZONE_RPE = [2.5, 4, 6, 7.5, 9]; // z1..z5

export interface BudgetSummary {
  /** Peak weekly aerobic volume, hours (from the biggest week). */
  peakHours: number;
  /** Peak weekly running mileage (0 for run-less sports). */
  peakMiles: number;
  /** Peak weekly session-RPE load estimate (arbitrary units). */
  peakLoadAu: number;
  /** Program-average intensity split, percentages summing to 100. */
  mix: { easy: number; threshold: number; hard: number };
}

/**
 * Summarize the generated program for the budget card: peak volume, a
 * session-RPE peak-load estimate (intensity x time), and the average easy /
 * threshold / hard split (5-zone collapsed to 3). Returns null if there's no
 * program data yet.
 */
export function summarizeBudget(data: ProgramData | null): BudgetSummary | null {
  if (!data || !data.weeks || data.weeks.length === 0) return null;

  let peakMin = 0;
  let peakMiles = 0;
  let peakLoad = 0;
  const zoneSum = [0, 0, 0, 0, 0];

  for (const w of data.weeks) {
    const s = w.summary;
    const min = s.totalCardioMinutes ?? 0;
    const z = s.zoneDistribution;
    const zs = [z.z1, z.z2, z.z3, z.z4, z.z5];
    const total = zs.reduce((a, b) => a + b, 0) || 1;
    const avgRpe = zs.reduce((acc, v, i) => acc + (v / total) * ZONE_RPE[i]!, 0);
    const load = Math.round(min * avgRpe);
    if (min > peakMin) {
      peakMin = min;
      peakMiles = s.totalMileage ?? 0;
    }
    if (load > peakLoad) peakLoad = load;
    for (let i = 0; i < 5; i++) zoneSum[i]! += zs[i]!;
  }

  const zsum = zoneSum.reduce((a, b) => a + b, 0) || 1;
  const easy = Math.round(((zoneSum[0]! + zoneSum[1]!) / zsum) * 100);
  const threshold = Math.round(((zoneSum[2]! + zoneSum[3]!) / zsum) * 100);
  const hard = Math.max(0, 100 - easy - threshold);

  return {
    peakHours: Math.round((peakMin / 60) * 10) / 10,
    peakMiles: Math.round(peakMiles),
    peakLoadAu: peakLoad,
    mix: { easy, threshold, hard },
  };
}
