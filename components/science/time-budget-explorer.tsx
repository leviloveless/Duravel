"use client";

import { useState } from "react";

/**
 * Public, interactive "pick your sport + weekly hours" explorer for the Science
 * page. Mirrors the onboarding time-budget question in a marketing context:
 * it shows the athlete-level and the training tradeoff for each budget, plus a
 * qualitative intensity emphasis — WITHOUT exposing the engine's parameters.
 */

type Band = "h0_5" | "h5_10" | "h10_20" | "h20_30" | "h30_40";
type Cell = { level: string; tradeoff: string; emphasis: string };

const BANDS: { value: Band; label: string }[] = [
  { value: "h0_5", label: "0–5 h" },
  { value: "h5_10", label: "5–10 h" },
  { value: "h10_20", label: "10–20 h" },
  { value: "h20_30", label: "20–30 h" },
  { value: "h30_40", label: "30–40 h" },
];

// Intensity emphasis shifts from threshold-leaning at low volume toward
// polarized (mostly-easy + a little very-hard) at high volume — the core
// research finding, expressed qualitatively.
const EMPHASIS: Record<Band, string> = {
  h0_5: "Threshold-leaning — stimulus concentrated into fewer, harder sessions",
  h5_10: "Pyramidal — a solid easy base with 2–3 quality sessions",
  h10_20: "Pyramidal → polarized — a large easy base, hard work held to ~2–3 sessions",
  h20_30: "Strongly polarized — mostly easy volume, a small fixed dose of hard work",
  h30_40: "Strongly polarized — near-maximal easy volume; hard work capped by recovery",
};

const SPORTS: { value: string; label: string }[] = [
  { value: "hyrox", label: "HYROX" },
  { value: "deka_fit", label: "DEKA FIT" },
  { value: "deka_strong", label: "DEKA STRONG" },
  { value: "tri_olympic", label: "Olympic Triathlon" },
  { value: "tri_70_3", label: "Ironman 70.3" },
  { value: "tri_140_6", label: "Ironman 140.6" },
];

const DATA: Record<string, Record<Band, Cell>> = {
  hyrox: {
    h0_5: { level: "Recreational; competitive Open finisher", tradeoff: "Builds VO₂max, threshold & station efficiency; gives up running durability and aerobic-base depth.", emphasis: EMPHASIS.h0_5 },
    h5_10: { level: "Advanced age-grouper; Pro-qualifier attainable", tradeoff: "Adds race-specific durability; sacrifices only the last few % of aerobic base.", emphasis: EMPHASIS.h5_10 },
    h10_20: { level: "Elite / Pro", tradeoff: "Full durability, aerobic base and race simulation; sacrifices little.", emphasis: EMPHASIS.h10_20 },
    h20_30: { level: "Full-time Pro only", tradeoff: "Maximal durability; returns diminish and impact-injury risk becomes the limiter.", emphasis: EMPHASIS.h20_30 },
    h30_40: { level: "Pro peak-block only; not sustainable", tradeoff: "No added benefit beyond 20–30 h for most; camp/peak use only.", emphasis: EMPHASIS.h30_40 },
  },
  deka_fit: {
    h0_5: { level: "Recreational → competitive", tradeoff: "Glycolytic power, zone efficiency & VO₂max; little lost for FIT.", emphasis: EMPHASIS.h0_5 },
    h5_10: { level: "Competitive age-grouper", tradeoff: "Race-specific power-endurance + aerobic support; gives up back-end aerobic base.", emphasis: EMPHASIS.h5_10 },
    h10_20: { level: "Elite", tradeoff: "Everything DEKA FIT rewards; sacrifices little.", emphasis: EMPHASIS.h10_20 },
    h20_30: { level: "Over-prescribed for DEKA; Pro only", tradeoff: "Aerobic ceiling well past DEKA's demands; strong diminishing returns.", emphasis: EMPHASIS.h20_30 },
    h30_40: { level: "Not recommended for DEKA", tradeoff: "Volume exceeds event demand.", emphasis: EMPHASIS.h30_40 },
  },
  deka_strong: {
    h0_5: { level: "Recreational → competitive (fully sufficient)", tradeoff: "Strength-endurance & glycolytic power; no running, minimal aerobic volume needed.", emphasis: "Intensity-led — a short, near-maximal event" },
    h5_10: { level: "Elite", tradeoff: "More than enough for a ~10–14 min strength-endurance sprint.", emphasis: "Intensity-led — quality over volume" },
    h10_20: { level: "Over-prescribed for STRONG", tradeoff: "Excess aerobic volume for the event.", emphasis: "Excess volume for the demand" },
    h20_30: { level: "Not recommended", tradeoff: "Volume far exceeds event demand.", emphasis: "Excess volume for the demand" },
    h30_40: { level: "Not recommended", tradeoff: "Volume far exceeds event demand.", emphasis: "Excess volume for the demand" },
  },
  tri_olympic: {
    h0_5: { level: "Recreational; sprint-focused", tradeoff: "VO₂max, threshold & race pace; gives up aerobic base and swim-technique volume.", emphasis: EMPHASIS.h0_5 },
    h5_10: { level: "Competitive age-grouper", tradeoff: "Competitive readiness; sacrifices only marginal base.", emphasis: EMPHASIS.h5_10 },
    h10_20: { level: "Sub-elite / elite", tradeoff: "Base, economy, threshold & durability; sacrifices little.", emphasis: EMPHASIS.h10_20 },
    h20_30: { level: "Elite / Pro", tradeoff: "Elite aerobic depth; diminishing returns for Olympic distance.", emphasis: EMPHASIS.h20_30 },
    h30_40: { level: "Pro peak-block only", tradeoff: "No Olympic-specific return beyond 20–30 h.", emphasis: EMPHASIS.h30_40 },
  },
  tri_70_3: {
    h0_5: { level: "Survival-only; back-of-pack finisher", tradeoff: "Threshold/VO₂max & finishing fitness; gives up durability, fat oxidation, fuelling practice & run robustness.", emphasis: EMPHASIS.h0_5 },
    h5_10: { level: "Competitive age-grouper", tradeoff: "Credible mid-pack 70.3; sacrifices late-race durability depth.", emphasis: EMPHASIS.h5_10 },
    h10_20: { level: "Kona-70.3 qualifier / elite", tradeoff: "Durability, fat oxidation, GI tolerance & competitive readiness; sacrifices little.", emphasis: EMPHASIS.h10_20 },
    h20_30: { level: "Elite / Pro", tradeoff: "Elite durability and metabolic depth; approaching diminishing returns.", emphasis: EMPHASIS.h20_30 },
    h30_40: { level: "Pro only", tradeoff: "Marginal returns over 20–30 h; recovery-support dependent.", emphasis: EMPHASIS.h30_40 },
  },
  tri_140_6: {
    h0_5: { level: "Not advised except to finish", tradeoff: "Central fitness only; sacrifices nearly all durability, fuelling & structural prep — high blow-up/injury risk.", emphasis: EMPHASIS.h0_5 },
    h5_10: { level: "Determined age-grouper; execution-dependent", tradeoff: "A realistic finish; sacrifices durability depth, GI robustness & injury margin.", emphasis: EMPHASIS.h5_10 },
    h10_20: { level: "Kona qualifier / strong age-grouper", tradeoff: "Durability, fat oxidation & GI tolerance — genuine competitiveness; near the amateur optimum.", emphasis: EMPHASIS.h10_20 },
    h20_30: { level: "Pro / full-time athlete", tradeoff: "Maximal durability and metabolic depth for 8 h+ racing; overtraining risk without full-time recovery.", emphasis: EMPHASIS.h20_30 },
    h30_40: { level: "Pro peak-block only", tradeoff: "Volume-gated ceiling for the longest events; net-negative without pro recovery infrastructure.", emphasis: EMPHASIS.h30_40 },
  },
};

export default function TimeBudgetExplorer() {
  const [sport, setSport] = useState<string>("hyrox");
  const [band, setBand] = useState<Band>("h5_10");
  const cell = DATA[sport]?.[band];

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            Sport
            <select
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            >
              {SPORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700">Weekly training time</span>
          <div className="flex flex-wrap gap-2">
            {BANDS.map((b) => {
              const active = band === b.value;
              return (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => setBand(b.value)}
                  className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-black bg-black text-white"
                      : "border-zinc-300 text-zinc-700 hover:border-zinc-400"
                  }`}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>

        {cell && (
          <div className="mt-1 rounded-xl bg-zinc-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Where this puts you
            </div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-zinc-900">
              {cell.level}
            </div>
            <p className="mt-2 text-sm text-zinc-600">{cell.tradeoff}</p>
            <div className="mt-3 flex items-start gap-2 border-t border-zinc-200 pt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Intensity mix
              </span>
              <span className="text-sm text-zinc-600">{cell.emphasis}</span>
            </div>
          </div>
        )}

        <p className="text-xs text-zinc-400">
          Illustrative. Your actual plan is individualized to your benchmarks, experience, and
          schedule. Longer events (70.3, Ironman) reward accumulated volume far more than short
          events (DEKA, HYROX), so the same weekly hours mean different things across sports.
        </p>
      </div>
    </div>
  );
}
