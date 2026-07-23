"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { updateProgramData } from "@/app/admin/actions";
import { ProgramDataSchema, type ProgramData, type Session } from "@/lib/schemas";
import { Button } from "@/components/ui/button";

/**
 * Structured (no-code) admin program editor (#15, Batch: admin editor).
 *
 * Renders programs.program_data as a FORM — weeks -> days -> sessions ->
 * movements — so an admin can swap exercises, change sets/reps/weight, add or
 * remove sessions, etc. without touching JSON or code. Every save goes through
 * the same schema-validated `updateProgramData` action, so a bad edit is
 * rejected rather than corrupting the athlete's program. Each session editor
 * spreads the original session, so fields it doesn't render are preserved.
 */

const RUN_TYPES = ["easy", "fartlek", "progression", "long", "tempo", "threshold", "interval", "hybrid_run"] as const;
const LIFT_TYPES = ["upper", "lower", "full", "power"] as const;
const PATTERNS = ["squat", "hip_hinge", "lunge", "horizontal_press", "vertical_press", "horizontal_pull", "vertical_pull"] as const;
const EMPHASES = ["max_strength", "strength", "endurance"] as const;
const PRIORITIES = ["A", "B", "C"] as const;
const SWIM_TYPES = ["technique", "css", "threshold", "endurance", "open_water"] as const;
const BIKE_TYPES = ["endurance", "sweet_spot", "threshold", "vo2", "recovery"] as const;
const DISCIPLINES = ["bike", "run", "swim"] as const;
const ZONES = [1, 2, 3, 4, 5] as const;
const SESSION_KINDS = ["run", "lift", "hybrid", "cardio", "swim", "bike", "brick", "race"] as const;
const DAY_LABEL: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

type Kind = Session["kind"];

function defaultSession(kind: Kind): Session {
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

const inputCls = "rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-800";

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
  return <input type="number" className={inputCls} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />;
}
function OptNumInput({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  return <input type="number" className={inputCls} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
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

const rowCls = "grid grid-cols-2 gap-2 sm:grid-cols-4";

function SessionEditor({ session, onChange }: { session: Session; onChange: (s: Session) => void }) {
  const s = session;
  switch (s.kind) {
    case "run":
      return (
        <div className="flex flex-col gap-2">
          <div className={rowCls}>
            <Field label="Run type"><Select value={s.runType} onChange={(runType) => onChange({ ...s, runType })} options={RUN_TYPES} /></Field>
            <Field label="Duration (min)"><NumInput value={s.durationMin} onChange={(durationMin) => onChange({ ...s, durationMin })} /></Field>
            <Field label="Pace (min/mile)"><TextInput value={s.paceMinMile} onChange={(paceMinMile) => onChange({ ...s, paceMinMile })} placeholder="8:30" /></Field>
            <Field label="Distance (mi)"><NumInput value={s.distanceMiles} onChange={(distanceMiles) => onChange({ ...s, distanceMiles })} /></Field>
            <Field label="Goal zone"><ZoneSelect value={s.goalZone} onChange={(goalZone) => onChange({ ...s, goalZone })} /></Field>
            <label className="flex items-center gap-2 self-end text-xs text-zinc-600">
              <input type="checkbox" checked={!!s.compromised} onChange={(e) => onChange({ ...s, compromised: e.target.checked || undefined })} />
              Compromised long run
            </label>
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

export default function ProgramFormEditor({ programId, initialData }: { programId: string; initialData: unknown }) {
  const parsed = useMemo(() => ProgramDataSchema.safeParse(initialData), [initialData]);
  const [data, setData] = useState<ProgramData | null>(parsed.success ? parsed.data : null);
  const [weekIdx, setWeekIdx] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function mutate(fn: (d: ProgramData) => void) {
    setData((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
    setMsg(null);
  }

  if (!data) {
    return (
      <p className="text-sm text-amber-600">
        This program&apos;s data does not match the current schema — use the raw JSON editor below to repair it.
      </p>
    );
  }

  const week = data.weeks[weekIdx];

  function save() {
    setMsg(null);
    start(async () => {
      const r = await updateProgramData(programId, JSON.stringify(data));
      if (r.ok) { setDirty(false); setMsg({ kind: "ok", text: "Saved." }); }
      else setMsg({ kind: "err", text: r.error });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">Week</span>
        <select className={inputCls} value={weekIdx} onChange={(e) => setWeekIdx(Number(e.target.value))}>
          {data.weeks.map((w, i) => (
            <option key={w.weekNumber} value={i}>Week {w.weekNumber} — {w.phase}/{w.microWeek}</option>
          ))}
        </select>
        {week && (
          <span className="text-xs text-zinc-400">
            {Math.round(week.summary.totalMileage)} mi · {Math.round(week.summary.totalCardioMinutes)} cardio min
          </span>
        )}
      </div>

      {week && (
        <div className="flex flex-col gap-4">
          {week.days.map((day, di) => (
            <div key={day.day} className="rounded-xl border border-zinc-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{DAY_LABEL[day.day] ?? day.day}</h3>
                <div className="flex items-center gap-2">
                  <select
                    className={inputCls}
                    value=""
                    onChange={(e) => { const k = e.target.value as Kind; if (k) mutate((d) => { d.weeks[weekIdx]!.days[di]!.sessions.push(defaultSession(k)); }); }}
                  >
                    <option value="">+ Add session…</option>
                    {SESSION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
              </div>
              {day.sessions.length === 0 ? (
                <p className="text-xs text-zinc-400">Rest day (no sessions).</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {day.sessions.map((s, si) => (
                    <div key={si} className="rounded-lg bg-zinc-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{s.kind}</span>
                        <button type="button" className="text-xs text-red-600 underline" onClick={() => mutate((d) => { d.weeks[weekIdx]!.days[di]!.sessions.splice(si, 1); })}>Remove session</button>
                      </div>
                      <SessionEditor session={s} onChange={(ns) => mutate((d) => { d.weeks[weekIdx]!.days[di]!.sessions[si] = ns; })} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="sticky bottom-2 flex items-center gap-3 rounded-lg border border-zinc-200 bg-white/90 p-2 backdrop-blur">
        <Button variant="primary" size="sm" onClick={save} disabled={pending || !dirty}>{pending ? "Saving…" : "Save program"}</Button>
        {dirty && !pending && <span className="text-xs text-amber-600">Unsaved changes</span>}
        {msg && <span className={`text-xs ${msg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
