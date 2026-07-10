"use client";

import { useActionState, useRef, useState } from "react";
import { submitOnboarding, type OnboardingState } from "./actions";
import type { ProfileRow } from "@/lib/supabase/queries";

const initialState: OnboardingState = { error: null };

const EXPERIENCE_DEFS = {
  running: {
    label: "Running experience",
    options: [
      { value: "beginner", label: "Beginner", def: "Sustained <15 miles/week over the last 6 months" },
      { value: "intermediate", label: "Intermediate", def: "Sustained 15–30 miles/week over the last 6 months" },
      { value: "advanced", label: "Advanced", def: "Sustained >30 miles/week over the last 6 months" },
    ],
  },
  hybrid: {
    label: "Hybrid fitness experience",
    options: [
      { value: "beginner", label: "Beginner", def: "≤1 hybrid HIIT workout/week over the last 6 months" },
      { value: "intermediate", label: "Intermediate", def: "2 hybrid HIIT workouts/week over the last 6 months" },
      { value: "advanced", label: "Advanced", def: "≥3 hybrid HIIT workouts/week over the last 6 months" },
    ],
  },
  lifting: {
    label: "Lifting experience",
    options: [
      { value: "beginner", label: "Beginner", def: "Lifting consistently for <3 years" },
      { value: "intermediate", label: "Intermediate", def: "Lifting consistently for 3–5 years" },
      { value: "advanced", label: "Advanced", def: "Lifting consistently for >5 years" },
    ],
  },
} as const;

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
] as const;

const STEPS = ["About you", "Experience", "Schedule & goal", "Benchmarks"] as const;

type ProgramType = "goal_event" | "fixed_duration" | "general_fitness";
type Race = { date: string; priority: "A" | "B" | "C" };

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 focus:border-black focus:outline-none";

export default function OnboardingForm({ profile }: { profile: ProfileRow | null }) {
  const [state, formAction, pending] = useActionState(submitOnboarding, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);

  const [days, setDays] = useState<string[]>(profile?.training_days ?? []);
  const [programType, setProgramType] = useState<ProgramType>("goal_event");
  const [races, setRaces] = useState<Race[]>([{ date: "", priority: "A" }]);
  const [duration, setDuration] = useState(12);

  const showRaces = programType === "goal_event" || programType === "fixed_duration";
  const showDuration = programType !== "goal_event";
  const today = new Date().toISOString().slice(0, 10);

  function toggleDay(key: string) {
    setDays((d) => (d.includes(key) ? d.filter((x) => x !== key) : [...d, key]));
  }

  function updateRace(i: number, patch: Partial<Race>) {
    setRaces((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRace() {
    setRaces((rs) => [...rs, { date: "", priority: "B" }]);
  }
  function removeRace(i: number) {
    setRaces((rs) => rs.filter((_, idx) => idx !== i));
  }

  /** Validate the current step against the live form values before advancing. */
  function validateStep(current: number): string | null {
    const fd = formRef.current ? new FormData(formRef.current) : null;
    const get = (k: string) => (fd?.get(k) as string | null)?.trim() ?? "";

    if (current === 0) {
      if (!get("firstName")) return "Enter your first name.";
      const age = Number(get("age"));
      if (!age || age < 13 || age > 100) return "Enter an age between 13 and 100.";
      if (!(Number(get("bodyWeight")) > 0)) return "Enter your body weight.";
    }
    if (current === 2) {
      if (days.length < 3) return "Pick at least 3 training days.";
      if (showRaces && programType === "goal_event") {
        if (races.length === 0 || races.some((r) => !r.date)) return "Add a date for each race.";
        if (!races.some((r) => r.priority === "A")) return "Mark your main race as an A race.";
      }
      // fixed_duration races are optional; empty rows are ignored on submit.
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-6">
      {/* Progress indicator */}
      <ol className="flex items-center gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium ${
                i === step
                  ? "border-black bg-black text-white"
                  : i < step
                    ? "border-black bg-white text-black"
                    : "border-zinc-300 bg-white text-zinc-400"
              }`}
            >
              {i + 1}
            </span>
            <span className={i === step ? "font-medium" : "text-zinc-400"}>{label}</span>
          </li>
        ))}
      </ol>

      {/* Step 1 — About you */}
      <fieldset className={`flex flex-col gap-5 ${step === 0 ? "" : "hidden"}`}>
        <label className="flex flex-col gap-1 text-sm">
          First name
          <input name="firstName" defaultValue={profile?.first_name ?? ""} className={inputClass} />
        </label>
        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Age
            <input name="age" type="number" min={13} max={100} defaultValue={profile?.age ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Body weight
            <input name="bodyWeight" type="number" step="0.1" defaultValue={profile?.body_weight ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Unit
            <select name="weightUnit" defaultValue={profile?.weight_unit ?? "lbs"} className={inputClass}>
              <option value="lbs">lbs</option>
              <option value="kg">kg</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-zinc-500">Age sets your max heart rate (220 − age), used for training zones.</p>
      </fieldset>

      {/* Step 2 — Experience */}
      <fieldset className={`flex flex-col gap-6 ${step === 1 ? "" : "hidden"}`}>
        {(["running", "hybrid", "lifting"] as const).map((key) => {
          const group = EXPERIENCE_DEFS[key];
          const fieldName = `${key}Exp`;
          const current =
            key === "running" ? profile?.running_exp : key === "hybrid" ? profile?.hybrid_exp : profile?.lifting_exp;
          return (
            <fieldset key={key} className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 font-medium">{group.label}</legend>
              {group.options.map((opt) => (
                <label key={opt.value} className="flex items-start gap-2 rounded-md border border-zinc-200 px-3 py-2">
                  <input type="radio" name={fieldName} value={opt.value} defaultChecked={(current ?? "beginner") === opt.value} className="mt-1" />
                  <span>
                    <span className="font-medium">{opt.label}</span>
                    <span className="block text-xs text-zinc-500">{opt.def}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          );
        })}

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">Training classification</legend>
          {[
            { value: "non_highly_trained", label: "Non-highly trained", def: "No extensive history of high training volume" },
            { value: "highly_trained", label: "Highly trained", def: "Extensive high-volume history; supports a longer microcycle before a deload" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-start gap-2 rounded-md border border-zinc-200 px-3 py-2">
              <input type="radio" name="trainingClass" value={opt.value} defaultChecked={(profile?.training_class ?? "non_highly_trained") === opt.value} className="mt-1" />
              <span>
                <span className="font-medium">{opt.label}</span>
                <span className="block text-xs text-zinc-500">{opt.def}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </fieldset>

      {/* Step 3 — Schedule & goal */}
      <fieldset className={`flex flex-col gap-6 ${step === 2 ? "" : "hidden"}`}>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">Training days (pick at least 3)</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => {
              const on = days.includes(d.key);
              return (
                <label
                  key={d.key}
                  className={`cursor-pointer rounded-full border px-4 py-1.5 ${on ? "border-black bg-black text-white" : "border-zinc-300 text-zinc-700"}`}
                >
                  <input type="checkbox" name={`day_${d.key}`} checked={on} onChange={() => toggleDay(d.key)} className="sr-only" />
                  {d.label}
                </label>
              );
            })}
          </div>
          <span className="text-xs text-zinc-500">{days.length} selected</span>
        </fieldset>

        <label className="flex flex-col gap-1 text-sm">
          Program type
          <select name="programType" value={programType} onChange={(e) => setProgramType(e.target.value as ProgramType)} className={inputClass}>
            <option value="goal_event">Goal event (race date)</option>
            <option value="fixed_duration">Fixed duration</option>
            <option value="general_fitness">General fitness</option>
          </select>
        </label>

        {showRaces && (
          <fieldset className="flex flex-col gap-3 text-sm">
            <legend className="mb-1 font-medium">
              Races {programType === "goal_event" ? "(at least one, main race = A)" : "(optional)"}
            </legend>
            {races.map((r, i) => (
              <div key={i} className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1">
                  Date
                  <input type="date" min={today} value={r.date} onChange={(e) => updateRace(i, { date: e.target.value })} className={inputClass} />
                </label>
                <label className="flex flex-col gap-1">
                  Priority
                  <select value={r.priority} onChange={(e) => updateRace(i, { priority: e.target.value as Race["priority"] })} className={inputClass}>
                    <option value="A">A race</option>
                    <option value="B">B race</option>
                    <option value="C">C race</option>
                  </select>
                </label>
                {(races.length > 1 || programType !== "goal_event") && (
                  <button type="button" onClick={() => removeRace(i)} className="px-2 py-2 text-zinc-400 hover:text-red-600" aria-label="Remove race">
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addRace} className="self-start text-sm underline">
              + Add another race
            </button>
            {/* Hidden serialized race fields for the server action */}
            <input type="hidden" name="race_count" value={races.length} />
            {races.map((r, i) => (
              <div key={`h-${i}`}>
                <input type="hidden" name={`race_date_${i}`} value={r.date} />
                <input type="hidden" name={`race_priority_${i}`} value={r.priority} />
              </div>
            ))}
          </fieldset>
        )}

        {showDuration && (
          <label className="flex flex-col gap-1 text-sm">
            Program length: <span className="font-medium">{duration} weeks</span>
            <input name="durationWeeks" type="range" min={4} max={24} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            <span className="flex justify-between text-xs text-zinc-400">
              <span>4</span>
              <span>24</span>
            </span>
          </label>
        )}
      </fieldset>

      {/* Step 4 — Benchmarks */}
      <fieldset className={`flex flex-col gap-5 ${step === 3 ? "" : "hidden"}`}>
        <p className="text-sm text-zinc-500">Optional. Providing these lets the program calibrate paces and starting weights. Skip any you don&apos;t know.</p>
        <div className="grid grid-cols-2 gap-4 text-sm">
          {[
            ["mileTime", "1-mile time (mm:ss)", "text"],
            ["fiveKTime", "5K time (mm:ss)", "text"],
            ["tenKTime", "10K time (mm:ss)", "text"],
            ["ski2kTime", "2000m ski erg (mm:ss)", "text"],
            ["row2kTime", "2000m row erg (mm:ss)", "text"],
            ["fiveRmSquat", "5-rep max squat", "number"],
            ["fiveRmBench", "5-rep max bench", "number"],
            ["fiveRmDeadlift", "5-rep max deadlift", "number"],
            ["bike20MinCals", "Assault bike cals / 20 min", "number"],
          ].map(([name, label, type]) => (
            <label key={name} className="flex flex-col gap-1">
              {label}
              <input
                name={name}
                type={type === "number" ? "number" : "text"}
                step={type === "number" ? "1" : undefined}
                className={inputClass}
              />
            </label>
          ))}
        </div>
      </fieldset>

      {(stepError || state.error) && <p className="text-sm text-red-600">{stepError ?? state.error}</p>}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={back} disabled={step === 0} className="rounded-full px-4 py-2 text-sm text-zinc-600 disabled:opacity-0">
          ← Back
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={next} className="rounded-full bg-black px-6 py-2.5 text-white transition-colors hover:bg-zinc-800">
            Next
          </button>
        ) : (
          <button type="submit" disabled={pending} className="rounded-full bg-black px-6 py-2.5 text-white transition-colors hover:bg-zinc-800 disabled:opacity-50">
            {pending ? "Building your program…" : "Generate program"}
          </button>
        )}
      </div>
    </form>
  );
}
