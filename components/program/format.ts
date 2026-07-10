/**
 * Presentation helpers for the program view (Milestone 6).
 *
 * Pure functions only — they turn the typed program data into the exact output
 * strings the spec calls for (§5 session formats, §7 weekly summary) plus the
 * label/colour lookups the components use. Keeping these pure makes the
 * spec-format rendering unit-testable without a browser.
 */

import type {
  ProgramWeek,
  Session,
} from "@/lib/schemas";
import type { PhaseName } from "@/lib/engine/types";

type RunSession = Extract<Session, { kind: "run" }>;
type LiftSession = Extract<Session, { kind: "lift" }>;
type HybridSession = Extract<Session, { kind: "hybrid" }>;
type Movement = LiftSession["movements"][number];

// --- Labels ---

export const RUN_TYPE_LABEL: Record<RunSession["runType"], string> = {
  easy: "Easy run",
  fartlek: "Fartlek / progression run",
  long: "Long run",
  tempo: "Tempo run",
  threshold: "Threshold run",
  interval: "Interval run",
  hybrid_run: "Hybrid run",
};

export const LIFT_TYPE_LABEL: Record<LiftSession["liftType"], string> = {
  upper: "Upper body",
  lower: "Lower body",
  full: "Full body",
};

export const DAY_LABEL: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const PHASE_LABEL: Record<PhaseName, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
};

export const MICRO_LABEL: Record<ProgramWeek["microWeek"], string> = {
  rebound: "Rebound",
  increase: "Increase",
  deload: "Deload",
  taper: "Taper",
  race: "Race week",
};

/** "horizontal_press" → "Horizontal press" */
export function patternLabel(pattern: string): string {
  const spaced = pattern.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Display rep ranges with an en dash: "5-7" → "5–7". */
function enDash(range: string): string {
  return range.replace(/-/g, "–");
}

// --- Session line formats (spec §5) ---

/** `Easy run — 40 min @ 8:30 min/mile — 5 miles — Goal HR: Zone 2` */
export function runLine(s: RunSession): string {
  const miles = Number.isInteger(s.distanceMiles) ? String(s.distanceMiles) : s.distanceMiles.toFixed(1);
  return `${RUN_TYPE_LABEL[s.runType]} — ${Math.round(s.durationMin)} min @ ${s.paceMinMile} min/mile — ${miles} miles — Goal HR: Zone ${s.goalZone}`;
}

/** `Squat — 4 sets × 5–7 reps` (+ ` — ~185 lbs` when a weight is suggested) */
export function movementLine(m: Movement): string {
  const base = `${patternLabel(m.pattern)} — ${m.sets} sets × ${enDash(m.repRange)} reps`;
  return m.suggestedWeight ? `${base} — ${m.suggestedWeight}` : base;
}

/** `Hybrid Session — Goal HR: Zone 4` */
export function hybridHeader(s: HybridSession): string {
  return `Hybrid Session — Goal HR: Zone ${s.goalZone}`;
}

/** `Row erg — 500m` */
export function elementLine(el: HybridSession["elements"][number]): string {
  return `${el.exercise} — ${el.prescription}`;
}

export function raceLabel(priority: "A" | "B" | "C"): string {
  return `Race day — ${priority} race`;
}

// --- Session length estimate (Tasks additions #1, #2) ---

export interface SessionTiming {
  warmup: number;
  work: number;
  cooldown: number;
  total: number;
}

/** Warmup/cooldown minutes by run type (quality runs need a longer warmup). */
const RUN_WARMUP_COOLDOWN: Record<RunSession["runType"], [number, number]> = {
  easy: [5, 5],
  long: [5, 5],
  fartlek: [8, 5],
  tempo: [12, 8],
  threshold: [12, 8],
  interval: [15, 10],
  hybrid_run: [8, 5],
};

/** Hybrid work-time bounds (spec addition: 25–60 min of work). */
export const HYBRID_MIN_WORK = 25;
export const HYBRID_MAX_WORK = 60;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Estimated session length, split into warmup / work / cooldown / total.
 * Deterministic (no AI) so every session — including already-generated ones —
 * gets a consistent estimate. A race session returns zeros (event day).
 */
export function sessionTiming(session: Session): SessionTiming {
  if (session.kind === "run") {
    const [warmup, cooldown] = RUN_WARMUP_COOLDOWN[session.runType];
    const work = Math.max(1, Math.round(session.durationMin));
    return { warmup, work, cooldown, total: warmup + work + cooldown };
  }
  if (session.kind === "lift") {
    // ~2.5 min per working set (lift + rest); fall back to a sensible default.
    const sets = session.movements.reduce((n, m) => n + m.sets, 0);
    const work = sets > 0 ? Math.round(sets * 2.5) : 40;
    const warmup = 10;
    const cooldown = 5;
    return { warmup, work, cooldown, total: warmup + work + cooldown };
  }
  if (session.kind === "hybrid") {
    // Keep hybrid work time within the 25–60 min band.
    const work = clamp(Math.round(session.elements.length * 5), HYBRID_MIN_WORK, HYBRID_MAX_WORK);
    const warmup = 10;
    const cooldown = 5;
    return { warmup, work, cooldown, total: warmup + work + cooldown };
  }
  return { warmup: 0, work: 0, cooldown: 0, total: 0 };
}

/** Short workout-type label for the weekly table. */
export function sessionTypeLabel(session: Session): string {
  if (session.kind === "run") return RUN_TYPE_LABEL[session.runType];
  if (session.kind === "lift") return `${LIFT_TYPE_LABEL[session.liftType]} lift`;
  if (session.kind === "hybrid") return "Hybrid (HYROX)";
  return `${session.priority} race`;
}

/** Pace column value, or "—" when pace doesn't apply. */
export function sessionPace(session: Session): string {
  return session.kind === "run" ? `${session.paceMinMile}/mi` : "—";
}

/** HR-zone column value, or "—" when zone doesn't apply. */
export function sessionZone(session: Session): string {
  if (session.kind === "run" || session.kind === "hybrid") return `Zone ${session.goalZone}`;
  return "—";
}

// --- HR zone ↔ bpm ranges (Tasks addition #4) ---
// Zone bands as % of max HR: Z1 <60, Z2 60–70, Z3 70–80, Z4 80–90, Z5 90–100.

/** The bpm range for a zone given the user's max HR (220 − age). */
export function zoneHrRange(zone: number, maxHR: number): string {
  const bpm = (p: number) => Math.round(p * maxHR);
  switch (zone) {
    case 1:
      return `<${bpm(0.6)} bpm`;
    case 2:
      return `${bpm(0.6)}–${bpm(0.7)} bpm`;
    case 3:
      return `${bpm(0.7)}–${bpm(0.8)} bpm`;
    case 4:
      return `${bpm(0.8)}–${bpm(0.9)} bpm`;
    case 5:
      return `${bpm(0.9)}–${bpm(1.0)} bpm`;
    default:
      return "";
  }
}

/** Zone column with the user's applicable HR numbers, or "—" when N/A. */
export function sessionZoneLabel(session: Session, maxHR: number): string {
  if (session.kind === "run" || session.kind === "hybrid") {
    return `Zone ${session.goalZone} · ${zoneHrRange(session.goalZone, maxHR)}`;
  }
  return "—";
}

// --- Weekly totals derived from the actual sessions (Tasks additions #2,#3,#6) ---
//
// The engine's targets guide generation, but the numbers shown must MATCH the
// sessions in the week: cardio = warmup+work+cooldown of every run/hybrid
// session (weightlifting excluded); mileage = every run's distance plus the
// runs inside hybrid sessions.

const METERS_PER_MILE = 1609.34;
const DEFAULT_HYBRID_RUN_MILES = 1000 / METERS_PER_MILE; // 1000 m per hybrid run

/** Parse a distance ("1000m", "1 km", "0.6 mi") to miles, or null. */
function parseDistanceMiles(text: string): number | null {
  const t = text.toLowerCase();
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:miles|mile|mi)\b/);
  if (m) return parseFloat(m[1]);
  m = t.match(/(\d+(?:\.\d+)?)\s*km\b/);
  if (m) return parseFloat(m[1]) * 0.621371;
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:meters|metres|meter|metre|m)\b/);
  if (m) return parseFloat(m[1]) / METERS_PER_MILE;
  return null;
}

/** Running miles contained in a hybrid session's run elements. */
function hybridRunMiles(hybrid: HybridSession): number {
  let miles = 0;
  for (const el of hybrid.elements) {
    const isRun = /run/i.test(el.exercise) || /run/i.test(el.prescription);
    if (!isRun) continue;
    miles += parseDistanceMiles(el.prescription) ?? DEFAULT_HYBRID_RUN_MILES;
  }
  return miles;
}

/** Total weekly cardio minutes = warmup+work+cooldown of run + hybrid sessions
 *  (weightlifting excluded, per spec). */
export function weekCardioMinutes(week: ProgramWeek): number {
  let total = 0;
  for (const day of week.days) {
    for (const s of day.sessions) {
      if (s.kind === "run" || s.kind === "hybrid") total += sessionTiming(s).total;
    }
  }
  return total;
}

/** Total weekly running mileage = every run's distance + hybrid run distances. */
export function weekMileage(week: ProgramWeek): number {
  let miles = 0;
  for (const day of week.days) {
    for (const s of day.sessions) {
      if (s.kind === "run") miles += s.distanceMiles;
      else if (s.kind === "hybrid") miles += hybridRunMiles(s);
    }
  }
  return Math.round(miles * 10) / 10;
}

// --- Weekly summary (spec §7) ---

export interface ZoneEntry {
  zone: 1 | 2 | 3 | 4 | 5;
  label: string;
  pct: number;
  barClass: string;
}

const ZONE_BAR_CLASS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "bg-sky-300",
  2: "bg-emerald-400",
  3: "bg-amber-400",
  4: "bg-orange-500",
  5: "bg-red-500",
};

export function zoneEntries(zones: ProgramWeek["summary"]["zoneDistribution"]): ZoneEntry[] {
  return ([1, 2, 3, 4, 5] as const).map((z) => ({
    zone: z,
    label: `Zone ${z}`,
    pct: zones[`z${z}` as "z1" | "z2" | "z3" | "z4" | "z5"],
    barClass: ZONE_BAR_CLASS[z],
  }));
}

// --- Phase timeline ---

export interface PhaseBand {
  phase: PhaseName;
  label: string;
  weeks: number;
  startWeek: number;
  endWeek: number;
}

/** Contiguous same-phase bands across the program, in order. */
export function phaseBands(weeks: ProgramWeek[]): PhaseBand[] {
  const bands: PhaseBand[] = [];
  for (const w of weeks) {
    const last = bands[bands.length - 1];
    if (last && last.phase === w.phase) {
      last.weeks += 1;
      last.endWeek = w.weekNumber;
    } else {
      bands.push({ phase: w.phase, label: PHASE_LABEL[w.phase], weeks: 1, startWeek: w.weekNumber, endWeek: w.weekNumber });
    }
  }
  return bands;
}

/** Week numbers that host a race, with priority — for timeline markers. */
export function raceMarkers(weeks: ProgramWeek[]): { weekNumber: number; priority: "A" | "B" | "C" }[] {
  return weeks
    .filter((w) => w.raceDay)
    .map((w) => ({ weekNumber: w.weekNumber, priority: w.raceDay!.priority }));
}

// --- Calendar dates (Tasks additions #8, #9) ---
//
// Program weeks are Monday-anchored: week 1 is the Mon–Sun week containing the
// program's start date. Week N's Monday = (Monday of start week) + (N−1)×7 days,
// and each training day maps to its weekday within that week.

const DAY_OFFSET: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

/** Parse a "YYYY-MM-DD" string as a local date (no timezone shift). */
function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Monday on or before the given date (Mon=0 … Sun=6). */
function mondayOf(date: Date): Date {
  const weekdayFromMon = (date.getDay() + 6) % 7;
  const r = new Date(date);
  r.setDate(date.getDate() - weekdayFromMon);
  return r;
}

/** Monday that starts program week `weekNumber` (1-based). */
export function weekStartDate(startISO: string, weekNumber: number): Date {
  const m = mondayOf(parseISODate(startISO));
  m.setDate(m.getDate() + (weekNumber - 1) * 7);
  return m;
}

/** Calendar date of a given training day within a program week. */
export function dayDate(startISO: string, weekNumber: number, dayKey: string): Date {
  const ws = weekStartDate(startISO, weekNumber);
  ws.setDate(ws.getDate() + (DAY_OFFSET[dayKey] ?? 0));
  return ws;
}

function fmt(date: Date, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return date.toLocaleDateString(undefined, opts);
}

/** "Jul 13 – Jul 19" for a program week. */
export function weekRangeLabel(startISO: string, weekNumber: number): string {
  const s = weekStartDate(startISO, weekNumber);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return `${fmt(s)} – ${fmt(e)}`;
}

/** "Jul 13" for a single training day. */
export function dayDateLabel(startISO: string, weekNumber: number, dayKey: string): string {
  return fmt(dayDate(startISO, weekNumber, dayKey));
}

/** "Jul 6 – Sep 1" spanning a mesocycle (weeks startWeek…endWeek). */
export function phaseDateRangeLabel(startISO: string, startWeek: number, endWeek: number): string {
  const s = weekStartDate(startISO, startWeek);
  const e = new Date(weekStartDate(startISO, endWeek));
  e.setDate(e.getDate() + 6);
  return `${fmt(s)} – ${fmt(e)}`;
}

/** Tailwind colour set per phase, used by the timeline + week headers. */
export const PHASE_COLORS: Record<PhaseName, { band: string; chip: string; text: string; border: string }> = {
  base: { band: "bg-sky-500", chip: "bg-sky-100 text-sky-800", text: "text-sky-700", border: "border-sky-200" },
  build: { band: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-800", text: "text-emerald-700", border: "border-emerald-200" },
  peak: { band: "bg-orange-500", chip: "bg-orange-100 text-orange-800", text: "text-orange-700", border: "border-orange-200" },
  taper: { band: "bg-violet-500", chip: "bg-violet-100 text-violet-800", text: "text-violet-700", border: "border-violet-200" },
};
