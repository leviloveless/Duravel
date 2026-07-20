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
import {
  sessionTiming,
  weekMileage,
  weekCardioMinutes,
  HYBRID_MIN_WORK,
  HYBRID_MAX_WORK,
  type SessionTiming,
} from "@/lib/session-volume";

// Re-exported so existing importers of these from ./format keep working; the
// canonical implementations now live in lib/session-volume.ts (shared with the
// deterministic volume reconciler so display and reconciliation always agree).
export { sessionTiming, weekMileage, weekCardioMinutes, HYBRID_MIN_WORK, HYBRID_MAX_WORK };
export type { SessionTiming };

type RunSession = Extract<Session, { kind: "run" }>;
type LiftSession = Extract<Session, { kind: "lift" }>;
type HybridSession = Extract<Session, { kind: "hybrid" }>;
type Movement = LiftSession["movements"][number];

// --- Labels ---

export const RUN_TYPE_LABEL: Record<RunSession["runType"], string> = {
  easy: "Easy run",
  fartlek: "Fartlek run",
  progression: "Progression run",
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

const EMPHASIS_LABEL: Record<string, string> = {
  max_strength: "Max strength",
  strength: "Strength",
  endurance: "Muscular endurance",
};

/** `Back Squat — 4 sets × 3 reps — 285 lb (~88% 1RM · 1 RIR) · Max strength`.
 *  Leads with the specific A/B exercise (Tasks #10) when present, else the
 *  movement pattern (programs generated before exercises were named). */
export function movementLine(m: Movement): string {
  let line = `${m.exercise ?? patternLabel(m.pattern)} — ${m.sets} sets × ${enDash(m.repRange)} reps`;
  if (m.suggestedWeight) line += ` — ${m.suggestedWeight}`;
  if (m.emphasis && EMPHASIS_LABEL[m.emphasis]) line += ` · ${EMPHASIS_LABEL[m.emphasis]}`;
  return line;
}

/** `Plyometrics: box jumps — 4 × 3` (the reactive/power element, Review #4) */
export function powerElementLine(power: LiftSession["power"]): string | null {
  if (!power) return null;
  return `Plyometrics: ${power.exercise} — ${power.sets} × ${enDash(power.reps)}`;
}

/** `Hybrid Session — Goal HR: Zone 4` (or a Race Simulation, Review #9) */
export function hybridHeader(s: HybridSession): string {
  const name = s.simulation ? "Race Simulation (full HYROX)" : "Hybrid Session";
  return `${name} — Goal HR: Zone ${s.goalZone}`;
}

/** `Row erg — 500m` */
export function elementLine(el: HybridSession["elements"][number]): string {
  return `${el.exercise} — ${el.prescription}`;
}

export function raceLabel(priority: "A" | "B" | "C"): string {
  return `Race day — ${priority} race`;
}

/** Short workout-type label for the weekly table. */
export function sessionTypeLabel(session: Session): string {
  if (session.kind === "run") return RUN_TYPE_LABEL[session.runType];
  if (session.kind === "lift") return `${LIFT_TYPE_LABEL[session.liftType]} lift`;
  if (session.kind === "hybrid") return session.simulation ? "Race Simulation" : "Hybrid (HYROX)";
  if (session.kind === "cardio") return "Zone 1–2 cardio";
  if (session.kind === "swim") return `${session.sessionType.replace(/_/g, " ")} swim`;
  if (session.kind === "bike") return `${session.sessionType.replace(/_/g, " ")} ride`;
  if (session.kind === "brick") return "Brick (bike→run)";
  return `${session.priority} race`;
}

/** Pace column value, or "—" when pace doesn't apply. */
export function sessionPace(session: Session): string {
  return session.kind === "run" ? `${session.paceMinMile}/mi` : "—";
}

/** HR-zone column value, or "—" when zone doesn't apply. */
export function sessionZone(session: Session): string {
  if (
    session.kind === "run" ||
    session.kind === "hybrid" ||
    session.kind === "cardio" ||
    session.kind === "swim" ||
    session.kind === "bike" ||
    session.kind === "brick"
  )
    return `Zone ${session.goalZone}`;
  return "—";
}

// --- HR zone ↔ bpm ranges (Tasks addition #4; custom bands new-additions #3;
// personalized anchoring Review #3) ---
// Bands passed in are fractions of max HR (the page resolves them from the
// athlete's threshold/resting HR when available — see lib/zones.resolveHrModel).
// These defaults are the corrected %HRmax bands used when nothing better is
// known: Z1 <70, Z2 70–80, Z3 80–87, Z4 87–93, Z5 93–100 (so genuine easy
// running reads Zone 2 instead of being mislabeled Zone 3).

/** One zone's [low, high] bounds as fractions (0–1) of max HR. */
export type ZoneBand = { low: number; high: number };
export type ZoneBands = Record<1 | 2 | 3 | 4 | 5, ZoneBand>;

/** Standard %-of-max-HR bands used when the athlete hasn't set custom zones. */
export const DEFAULT_ZONE_BANDS: ZoneBands = {
  1: { low: 0, high: 0.7 },
  2: { low: 0.7, high: 0.8 },
  3: { low: 0.8, high: 0.87 },
  4: { low: 0.87, high: 0.93 },
  5: { low: 0.93, high: 1.0 },
};

/** The bpm range for a zone given the user's max HR and (optional) custom bands. */
export function zoneHrRange(zone: number, maxHR: number, bands: ZoneBands = DEFAULT_ZONE_BANDS): string {
  const band = bands[zone as 1 | 2 | 3 | 4 | 5];
  if (!band) return "";
  const bpm = (p: number) => Math.round(p * maxHR);
  if (band.low <= 0) return `<${bpm(band.high)} bpm`;
  if (band.high >= 1) return `${bpm(band.low)}+ bpm`;
  return `${bpm(band.low)}–${bpm(band.high)} bpm`;
}

/** Zone column with the user's applicable HR numbers, or "—" when N/A. */
export function sessionZoneLabel(session: Session, maxHR: number, bands: ZoneBands = DEFAULT_ZONE_BANDS): string {
  if (session.kind === "run" || session.kind === "hybrid" || session.kind === "cardio") {
    return `Zone ${session.goalZone} · ${zoneHrRange(session.goalZone, maxHR, bands)}`;
  }
  return "—";
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
  return new Date(y!, (m ?? 1) - 1, d ?? 1); // safe: split always yields at least one element, so y (index 0) is present
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
