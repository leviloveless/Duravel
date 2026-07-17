/**
 * Per-discipline training zones for triathlon (swim / bike / run).
 *
 * Triathlon can't be paced off a single VDOT the way a run race can — each
 * discipline has its own threshold anchor and its own zone currency:
 *   - Swim: CSS (critical swim speed) → pace bands per 100 m (Ginn/Swim Smooth).
 *   - Bike: FTP (functional threshold power) → Coggan power zones (watts).
 *   - Run:  VDOT threshold → Daniels pace bands (reuses paces.ts).
 *
 * All pure + deterministic. Each discipline is optional: a zone table is only
 * returned when the athlete supplied the anchoring benchmark, so the UI can show
 * exactly the disciplines the athlete has data for and nudge for the rest.
 */
import { computePaces, formatPace, parseTimeToSeconds, type RaceInput } from "./paces";

export interface ZoneRow {
  zone: string;
  label: string;
  range: string;
}

export interface SwimZones {
  cssPer100: string;
  zones: ZoneRow[];
}
export interface BikeZones {
  ftpWatts: number;
  zones: ZoneRow[];
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

/**
 * Swim zones as pace bands relative to CSS (seconds slower per 100 m). Faster
 * (smaller) pace = harder. Bands from Swim Smooth / CSS training practice.
 */
function swimZones(cssPace?: string): SwimZones | undefined {
  const css = cssPace ? parseTimeToSeconds(cssPace) : null;
  if (css === null || css <= 0) return undefined;
  // Offsets (sec/100 m) from CSS: [slower bound, faster bound]. Zone 1 is
  // open-ended slow; zone 5 is open-ended fast.
  const rows: { zone: string; label: string; from: number; to: number | null; open?: "slow" | "fast" }[] = [
    { zone: "Z1", label: "Recovery", from: 12, to: null, open: "slow" },
    { zone: "Z2", label: "Aerobic / endurance", from: 6, to: 11 },
    { zone: "Z3", label: "Tempo", from: 3, to: 5 },
    { zone: "Z4", label: "Threshold (CSS)", from: -2, to: 2 },
    { zone: "Z5", label: "Speed / VO₂", from: -3, to: null, open: "fast" },
  ];
  const zones: ZoneRow[] = rows.map((r) => {
    if (r.open === "slow") return { zone: r.zone, label: r.label, range: `${fmtSwim(css + r.from)}+ /100m` };
    if (r.open === "fast") return { zone: r.zone, label: r.label, range: `${fmtSwim(css + r.from)} or faster` };
    // Faster pace is the smaller number → show fast–slow.
    return { zone: r.zone, label: r.label, range: `${fmtSwim(css + r.to!)}–${fmtSwim(css + r.from)} /100m` };
  });
  return { cssPer100: fmtSwim(css), zones };
}

/** Coggan power zones (% FTP), collapsed to five bands, expressed in watts. */
function bikeZones(ftpWatts?: number): BikeZones | undefined {
  if (!ftpWatts || ftpWatts <= 0) return undefined;
  const w = (frac: number) => Math.round(ftpWatts * frac);
  const rows: { zone: string; label: string; lo: number; hi: number | null }[] = [
    { zone: "Z1", label: "Active recovery", lo: 0, hi: 0.55 },
    { zone: "Z2", label: "Endurance", lo: 0.56, hi: 0.75 },
    { zone: "Z3", label: "Tempo / sweet spot", lo: 0.76, hi: 0.9 },
    { zone: "Z4", label: "Threshold (FTP)", lo: 0.91, hi: 1.05 },
    { zone: "Z5", label: "VO₂max", lo: 1.06, hi: null },
  ];
  const zones: ZoneRow[] = rows.map((r) =>
    r.hi === null
      ? { zone: r.zone, label: r.label, range: `${w(r.lo)}W+` }
      : { zone: r.zone, label: r.label, range: `${w(r.lo)}–${w(r.hi)}W` },
  );
  return { ftpWatts, zones };
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

/** Compute whichever per-discipline zone tables the athlete has anchors for. */
export function computeTriZones(input: TriZoneInput): TriZones {
  const out: TriZones = {};
  const swim = swimZones(input.cssPace);
  const bike = bikeZones(input.ftpWatts);
  const run = runZones(input.benchmarks);
  if (swim) out.swim = swim;
  if (bike) out.bike = bike;
  if (run) out.run = run;
  return out;
}
