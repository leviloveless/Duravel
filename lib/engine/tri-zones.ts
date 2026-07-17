/**
 * Per-discipline training zones for triathlon (swim / bike / run).
 *
 * Triathlon can't be paced off a single VDOT the way a run race can — each
 * discipline has its own threshold anchor and its own zone currency:
 *   - Swim: CSS (critical swim speed) → pace bands per 100 m (Ginn/Swim Smooth).
 *   - Bike: FTP (functional threshold power) → Coggan power zones (watts), with
 *           heart rate (% of lactate-threshold HR) as a SECONDARY monitor.
 *   - Run:  VDOT threshold → Daniels pace bands (reuses paces.ts).
 *
 * All pure + deterministic. Swim and bike zones are ALWAYS returned so the UI
 * can show every discipline: when the athlete supplied the anchoring benchmark
 * (CSS / FTP) the ranges are exact (pace / watts); otherwise they fall back to
 * % of FTP and effort descriptors, with a nudge to add the anchor for exact
 * numbers. Run zones need a running benchmark (5K etc.) to compute a VDOT.
 */
import { computePaces, formatPace, parseTimeToSeconds, type RaceInput } from "./paces";

export interface ZoneRow {
  zone: string;
  label: string;
  /** Primary target for the discipline (pace, watts, or % of threshold). */
  range: string;
  /** Secondary monitor (currently heart rate, % of LTHR) — bike only for now. */
  hr?: string;
}

export interface SwimZones {
  /** CSS pace per 100 m when known ("m:ss"); undefined when the athlete has none. */
  cssPer100?: string;
  zones: ZoneRow[];
  /** Nudge shown when CSS is missing (ranges are effort-based until then). */
  note?: string;
}
export interface BikeZones {
  /** FTP in watts when known; undefined when the athlete has none. */
  ftpWatts?: number;
  zones: ZoneRow[];
  /** Nudge shown when FTP is missing (ranges are % of FTP until then). */
  note?: string;
}
export interface RunZones {
  vdot: number;
  zones: ZoneRow[];
}

export interface TriZones {
  swim?: SwimZones;
  bike?: BikeZones;
  run?: RunZones;
}

export interface TriZoneInput {
  /** Swim CSS pace per 100 m, "mm:ss" (e.g. "1:40"). */
  cssPace?: string;
  /** Bike FTP in watts. */
  ftpWatts?: number;
  /** Run benchmarks (reuses the VDOT model). */
  benchmarks?: RaceInput;
}

/** Format seconds/100 m as "m:ss/100m". */
function fmtSwim(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Five swim bands: label, CSS offset (sec/100 m), and an effort fallback. */
const SWIM_BANDS: {
  zone: string;
  label: string;
  from: number;
  to: number | null;
  open?: "slow" | "fast";
  effort: string;
}[] = [
  { zone: "Z1", label: "Recovery", from: 12, to: null, open: "slow", effort: "Very easy — recovery, technique focus" },
  { zone: "Z2", label: "Aerobic / endurance", from: 6, to: 11, effort: "Easy, steady aerobic — long, relaxed stroke" },
  { zone: "Z3", label: "Tempo", from: 3, to: 5, effort: "Moderately hard, controlled and smooth" },
  { zone: "Z4", label: "Threshold (CSS)", from: -2, to: 2, effort: "Hard — ~1 hr race effort (your CSS)" },
  { zone: "Z5", label: "Speed / VO₂", from: -3, to: null, open: "fast", effort: "Very hard — short, fast reps" },
];

/**
 * Swim zones as pace bands relative to CSS (seconds slower per 100 m). Faster
 * (smaller) pace = harder. Bands from Swim Smooth / CSS training practice.
 * Always returns a table: without a CSS anchor the ranges are effort-based.
 */
function swimZones(cssPace?: string): SwimZones {
  const css = cssPace ? parseTimeToSeconds(cssPace) : null;
  const hasCss = css !== null && css > 0;
  const zones: ZoneRow[] = SWIM_BANDS.map((r) => {
    if (!hasCss) return { zone: r.zone, label: r.label, range: r.effort };
    if (r.open === "slow") return { zone: r.zone, label: r.label, range: `${fmtSwim(css! + r.from)}+ /100m` };
    if (r.open === "fast") return { zone: r.zone, label: r.label, range: `${fmtSwim(css! + r.from)} or faster /100m` };
    // Faster pace is the smaller number → show fast–slow.
    return { zone: r.zone, label: r.label, range: `${fmtSwim(css! + r.to!)}–${fmtSwim(css! + r.from)} /100m` };
  });
  return {
    cssPer100: hasCss ? fmtSwim(css!) : undefined,
    zones,
    note: hasCss ? undefined : "Add your swim CSS pace to convert these into exact per-100 m targets.",
  };
}

/**
 * Five Coggan power bands, expressed in watts (when FTP known) or % of FTP.
 * Each band also carries a secondary heart-rate target as % of lactate-threshold
 * HR (LTHR) — HR lags power, so it's a monitor, not the primary target, and is
 * unreliable in Z5 where efforts are too short for HR to respond.
 */
const BIKE_BANDS: {
  zone: string;
  label: string;
  lo: number;
  hi: number | null;
  pct: string;
  hr: string;
}[] = [
  { zone: "Z1", label: "Active recovery", lo: 0, hi: 0.55, pct: "≤55% FTP", hr: "<68% LTHR" },
  { zone: "Z2", label: "Endurance", lo: 0.56, hi: 0.75, pct: "56–75% FTP", hr: "69–83% LTHR" },
  { zone: "Z3", label: "Tempo / sweet spot", lo: 0.76, hi: 0.9, pct: "76–90% FTP", hr: "84–94% LTHR" },
  { zone: "Z4", label: "Threshold (FTP)", lo: 0.91, hi: 1.05, pct: "91–105% FTP", hr: "95–105% LTHR" },
  { zone: "Z5", label: "VO₂max", lo: 1.06, hi: null, pct: "106%+ FTP", hr: ">106% LTHR (HR lags — use power)" },
];

function bikeZones(ftpWatts?: number): BikeZones {
  const hasFtp = !!ftpWatts && ftpWatts > 0;
  const w = (frac: number) => Math.round(ftpWatts! * frac);
  const zones: ZoneRow[] = BIKE_BANDS.map((r) => {
    let range: string;
    if (!hasFtp) range = r.pct;
    else if (r.hi === null) range = `${w(r.lo)}W+`;
    else range = `${w(r.lo)}–${w(r.hi)}W`;
    return { zone: r.zone, label: r.label, range, hr: r.hr };
  });
  return {
    ftpWatts: hasFtp ? ftpWatts : undefined,
    zones,
    note: hasFtp ? undefined : "Add your bike FTP (watts) to convert these into exact power targets.",
  };
}

/** Run zones from VDOT (Daniels), expressed as pace ranges per mile. */
function runZones(benchmarks?: RaceInput): RunZones | undefined {
  const p = computePaces(benchmarks ?? {});
  if (!p) return undefined;
  const zones: ZoneRow[] = [
    { zone: "Z1–2", label: "Easy / long", range: `${formatPace(p.easy)}/mi` },
    { zone: "Z3", label: "Tempo", range: `${formatPace(p.tempo)}/mi` },
    { zone: "Z4", label: "Threshold", range: `${formatPace(p.threshold)}/mi` },
    { zone: "Z5", label: "Interval / VO₂", range: `${formatPace(p.interval)}/mi` },
  ];
  return { vdot: p.vdot, zones };
}

/**
 * Compute per-discipline zone tables. Swim and bike are always present (with
 * effort / % of FTP fallbacks when the CSS / FTP anchor is missing); run is
 * present when a running benchmark yields a VDOT.
 */
export function computeTriZones(input: TriZoneInput): TriZones {
  const out: TriZones = {
    swim: swimZones(input.cssPace),
    bike: bikeZones(input.ftpWatts),
  };
  const run = runZones(input.benchmarks);
  if (run) out.run = run;
  return out;
}
