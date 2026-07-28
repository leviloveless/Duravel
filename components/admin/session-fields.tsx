"use client";

import { type ReactNode } from "react";
import type { Session } from "@/lib/schemas";

/**
 * Shared, schema-shaped session field editors — used by both the bulk admin
 * program editor (program-form-editor) and the inline "Save as Coach" editor on
 * the athlete view (coach-session-edit). Each editor spreads the original
 * session, so any field it doesn't render is preserved.
 *
 * Runs sync duration from distance x pace (and vice versa), so bumping a run's
 * mileage also raises its time — which is what makes the weekly cardio total
 * move when a coach edits distance.
 */

export const RUN_TYPES = ["easy", "fartlek", "progression", "long", "tempo", "threshold", "interval", "hybrid_run"] as const;
export const LIFT_TYPES = ["upper", "lower", "full", "power"] as const;
export const PATTERNS = ["squat", "hip_hinge", "lunge", "horizontal_press", "vertical_press", "horizontal_pull", "vertical_pull"] as const;
export const EMPHASES = ["max_strength", "strength", "endurance"] as const;
export const PRIORITIES = ["A", "B", "C"] as const;
export const SWIM_TYPES = ["technique", "css", "threshold", "endurance", "open_water"] as const;
export const BIKE_TYPES = ["endurance", "sweet_spot", "threshold", "vo2", "recovery"] as const;
export const DISCIPLINES = ["bike", "run", "swim"] as const;
export const ZONES = [1, 2, 3, 4, 5] as const;
export const SESSION_KINDS = ["run", "lift", "hybrid", "cardio", "swim", "bike", "brick", "race"] as const;

export type Kind = Session["kind"];

export function defaultSession(kind: Kind): Session {
  switch (kind) {
    case "run": return { kind: "run", runType: "easy", durationMin: 40, paceMinMile: "", distanceMiles: 0, goalZone: 2 };
    case "lift": return { kind: "lift", liftType: "full", movements: [] };
    case "hybrid": return { kind: "hybrid", goalZone: 4, elements: [] };
    case "cardio": return { kind: "cardio", durationMin: 45, goalZone: 2 };
    case "swim": return { kind: "swim", durationMin: 30, goalZone: 2, sessionType: "endurance" };
    case "bike": return { kind: "bike", durationMin: 45, goalZone: 2, sessionType: "endurance" };
    case "brick": return { kind: "brick", goalZone: 3, segments: [] };
    case "race": return { kind: "race", priority: "A" };
  }
}

export const inputCls = "rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-800";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-zinc-500">{label}</span>
      {children}
    </label>
  );
}
function TextInput({ value, onChange, placeholder }: { value: string | undefined; onChange: (v: string) => void; placeholder?: string }) {
  return <input className={inputCls} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}
function NumInput({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  return <input type="number" step="any" className={inputCls} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />;
}
function OptNumInput({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  return <input type="number" step="any" className={inputCls} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
}
function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly T[] }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
    </select>
  );
}
function ZoneSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {ZONES.map((z) => <option key={z} value={z}>Zone {z}</option>)}
    </select>
  );
}

/** Parse "8:30" -> 8.5 min/mile, or a bare number, else null. */
function paceToMinutes(pace: string): number | null {
  const t = pace.trim();
  if (!t) return null;
  const m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** Duration a run should take at its pace for a distance; falls back if pace is blank. */
function syncedDuration(distanceMiles: number, pace: string, fallback: number): number {
  const p = paceToMinutes(pace);
  if (p == null || !(distanceMiles > 0)) return fallback;
  return Math.max(1, Math.round(distanceMiles * p));
}

const rowCls = "grid grid-cols-2 gap-2 sm:grid-cols-4";

export function SessionFields({ session, onChange }: { session: Session; onChange: (s: Session) => void }) {
  const s = session;
  switch (s.kind) {
    case "run":
      return (
        <div className="flex flex-col gap-2">
          <div className={rowCls}>
            <Field label="Run type"><Select value={s.runType} onChange={(runType) => onChange({ ...s, runType })} options={RUN_TYPES} /></Field>
            <Field label="Distance (mi)"><NumInput value={s.distanceMiles} onChange={(distanceMiles) => onChange({ ...s, distanceMiles, durationMin: syncedDuration(distanceMiles, s.paceMinMile, s.durationMin) })} /></Field>
            <Field label="Pace (min/mile)"><TextInput value={s.paceMinMile} onChange={(paceMinMile) => onChange({ ...s, paceMinMile, durationMin: syncedDuration(s.distanceMiles, paceMinMile, s.durationMin) })} placeholder="8:30" /></Field>
            <Field label="Duration (min)"><NumInput value={s.durationMin} onChange={(durationMin) => onChange({ ...s, durationMin })} /></Field>
            <Field label="Goal zone"><ZoneSelect value={s.goalZone} onChange={(goalZone) => onChange({ ...s, goalZone })} /></Field>
          </div>
          <Field label="Description"><TextInput value={s.description} onChange={(description) => onChange({ ...s, description })} /></Field>
        </div>
      );
    case "lift": {
      const setMovement = (mi: number, m: (typeof s.movements)[number]) => {
        const movements = s.movements.slice(); movements[mi] = m; onChange({ ...s, movements });
      };
      return (
        <div className="flex flex-col gap-3">
          <Field label="Lift type"><Select value={s.liftType} onChange={(liftType) => onChange({ ...s, liftType })} options={LIFT_TYPES} /></Field>
          <div className="flex flex-col gap-2">
            {s.movements.map((m, mi) => (
              <div key={mi} className="rounded-lg border border-zinc-200 p-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Field label="Pattern"><Select value={m.pattern} onChange={(pattern) => setMovement(mi, { ...m, pattern })} options={PATTERNS} /></Field>
                  <Field label="Exercise"><TextInput value={m.exercise} onChange={(exercise) => setMovement(mi, { ...m, exercise })} placeholder="Back Squat" /></Field>
                  <Field label="Weight"><TextInput value={m.suggestedWeight} onChange={(suggestedWeight) => setMovement(mi, { ...m, suggestedWeight })} placeholder="285 lb" /></Field>
                  <Field label="Sets"><NumInput value={m.sets} onChange={(sets) => setMovement(mi, { ...m, sets })} /></Field>
                  <Field label="Reps"><TextInput value={m.repRange} onChange={(repRange) => setMovement(mi, { ...m, repRange })} placeholder="4-5" /></Field>
                  <Field label="Emphasis"><Select value={m.emphasis ?? "strength"} onChange={(emphasis) => setMovement(mi, { ...m, emphasis })} options={EMPHASES} /></Field>
                  <Field label="Intensity %"><OptNumInput value={m.intensityPct} onChange={(intensityPct) => setMovement(mi, { ...m, intensityPct })} /></Field>
                  <Field label="RIR"><OptNumInput value={m.rir} onChange={(rir) => setMovement(mi, { ...m, rir })} /></Field>
                </div>
                <button type="button" className="mt-2 text-xs text-red-600 underline" onClick={() => onChange({ ...s, movements: s.movements.filter((_, i) => i !== mi) })}>Remove movement</button>
              </div>
            ))}
            <button type="button" className="self-start text-xs text-emerald-700 underline" onClick={() => onChange({ ...s, movements: [...s.movements, { pattern: "squat", sets: 3, repRange: "8-10" }] })}>+ Add movement</button>
          </div>
        </div>
      );
    }
    case "hybrid": {
      const setEl = (ei: number, el: (typeof s.elements)[number]) => {
        const elements = s.elements.slice(); elements[ei] = el; onChange({ ...s, elements });
      };
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4">
            <Field label="Goal zone"><ZoneSelect value={s.goalZone} onChange={(goalZone) => onChange({ ...s, goalZone })} /></Field>
            <label className="flex items-center gap-2 self-end text-xs text-zinc-600">
              <input type="checkbox" checked={!!s.simulation} onChange={(e) => onChange({ ...s, simulation: e.target.checked || undefined })} />
              Race simulation
            </label>
          </div>
          {s.elements.map((el, ei) => (
            <div key={ei} className="grid grid-cols-2 gap-2">
              <Field label="Station / exercise"><TextInput value={el.exercise} onChange={(exercise) => setEl(ei, { ...el, exercise })} /></Field>
              <Field label="Prescription"><TextInput value={el.prescription} onChange={(prescription) => setEl(ei, { ...el, prescription })} placeholder="1000m @ threshold" /></Field>
              <button type="button" className="col-span-2 self-start text-xs text-red-600 underline" onClick={() => onChange({ ...s, elements: s.elements.filter((_, i) => i !== ei) })}>Remove element</button>
            </div>
          ))}
          <button type="button" className="self-start text-xs text-emerald-700 underline" onClick={() => onChange({ ...s, elements: [...s.elements, { exercise: "", prescription: "" }] })}>+ Add element</button>
        </div>
      );
    }
    case "cardio":
      return (
        <div className={rowCls}>
          <Field label="Duration (min)"><NumInput value={s.durationMin} onChange={(durationMin) => onChange({ ...s, durationMin })} /></Field>
          <Field label="Goal zone"><ZoneSelect value={s.goalZone} onChange={(goalZone) => onChange({ ...s, goalZone })} /></Field>
          <Field label="Modality"><TextInput value={s.modality} onChange={(modality) => onChange({ ...s, modality })} placeholder="bike / row / ski" /></Field>
          <Field label="Description"><TextInput value={s.description} onChange={(description) => onChange({ ...s, description })} /></Field>
        </div>
      );
    case "swim":
      return (
        <div className={rowCls}>
          <Field label="Duration (min)"><NumInput value={s.durationMin} onChange={(durationMin) => onChange({ ...s, durationMin })} /></Field>
          <Field label="Goal zone"><ZoneSelect value={s.goalZone} onChange={(goalZone) => onChange({ ...s, goalZone })} /></Field>
          <Field label="Type"><Select value={s.sessionType} onChange={(sessionType) => onChange({ ...s, sessionType })} options={SWIM_TYPES} /></Field>
          <Field label="Description"><TextInput value={s.description} onChange={(description) => onChange({ ...s, description })} /></Field>
        </div>
      );
    case "bike":
      return (
        <div className={rowCls}>
          <Field label="Duration (min)"><NumInput value={s.durationMin} onChange={(durationMin) => onChange({ ...s, durationMin })} /></Field>
          <Field label="Goal zone"><ZoneSelect value={s.goalZone} onChange={(goalZone) => onChange({ ...s, goalZone })} /></Field>
          <Field label="Type"><Select value={s.sessionType} onChange={(sessionType) => onChange({ ...s, sessionType })} options={BIKE_TYPES} /></Field>
          <Field label="Description"><TextInput value={s.description} onChange={(description) => onChange({ ...s, description })} /></Field>
        </div>
      );
    case "brick": {
      const setSeg = (gi: number, seg: (typeof s.segments)[number]) => {
        const segments = s.segments.slice(); segments[gi] = seg; onChange({ ...s, segments });
      };
      return (
        <div className="flex flex-col gap-2">
          <Field label="Goal zone"><ZoneSelect value={s.goalZone} onChange={(goalZone) => onChange({ ...s, goalZone })} /></Field>
          {s.segments.map((seg, gi) => (
            <div key={gi} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Discipline"><Select value={seg.discipline} onChange={(discipline) => setSeg(gi, { ...seg, discipline })} options={DISCIPLINES} /></Field>
              <Field label="Duration (min)"><NumInput value={seg.durationMin} onChange={(durationMin) => setSeg(gi, { ...seg, durationMin })} /></Field>
              <Field label="Goal zone"><ZoneSelect value={seg.goalZone} onChange={(goalZone) => setSeg(gi, { ...seg, goalZone })} /></Field>
              <Field label="Note"><TextInput value={seg.note} onChange={(note) => setSeg(gi, { ...seg, note })} /></Field>
              <button type="button" className="col-span-2 self-start text-xs text-red-600 underline sm:col-span-4" onClick={() => onChange({ ...s, segments: s.segments.filter((_, i) => i !== gi) })}>Remove segment</button>
            </div>
          ))}
          <button type="button" className="self-start text-xs text-emerald-700 underline" onClick={() => onChange({ ...s, segments: [...s.segments, { discipline: "run", durationMin: 20, goalZone: 2 }] })}>+ Add segment</button>
        </div>
      );
    }
    case "race":
      return (
        <Field label="Race priority"><Select value={s.priority} onChange={(priority) => onChange({ ...s, priority })} options={PRIORITIES} /></Field>
      );
  }
}
