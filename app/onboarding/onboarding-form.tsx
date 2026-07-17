"use client";

import { startTransition, useActionState, useRef, useState, type KeyboardEvent } from "react";
import { submitOnboarding, updateProgramInputs, type OnboardingState } from "./actions";
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
  swim: {
    label: "Swim experience",
    options: [
      { value: "beginner", label: "Beginner", def: "Can't swim the race distance continuously, or CSS slower than 2:00/100m" },
      { value: "intermediate", label: "Intermediate", def: "Swims the distance continuously; CSS 1:35–2:00/100m" },
      { value: "advanced", label: "Advanced", def: "CSS faster than 1:35/100m; open-water comfortable" },
    ],
  },
  bike: {
    label: "Bike experience",
    options: [
      { value: "beginner", label: "Beginner", def: "FTP under 2.9 W/kg (M) / 2.4 (F); can't hold aero long" },
      { value: "intermediate", label: "Intermediate", def: "FTP 2.9–3.6 (M) / 2.4–3.0 (F) W/kg; holds aero most of the race" },
      { value: "advanced", label: "Advanced", def: "FTP over 3.6 (M) / 3.0 (F) W/kg; holds target power in aero" },
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

/** Toggleable day pills (accessible checkbox inside a pill label). Extracted
 *  from the block that was duplicated 5× in this form (roadmap #2.7). */
function DayPills({
  options,
  selected,
  namePrefix,
  onToggle,
}: {
  options: readonly { key: string; label: string }[];
  selected: string[];
  namePrefix: string;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((d) => {
        const on = selected.includes(d.key);
        return (
          <label
            key={d.key}
            className={`cursor-pointer rounded-full border px-4 py-1.5 ${on ? "border-black bg-black text-white" : "border-zinc-300 text-zinc-700"}`}
          >
            <input
              type="checkbox"
              name={`${namePrefix}_${d.key}`}
              checked={on}
              onChange={() => onToggle(d.key)}
              aria-pressed={on}
              className="sr-only"
            />
            {d.label}
          </label>
        );
      })}
    </div>
  );
}

/** Standard %-of-max-HR bands, used as the default when custom zones are off. */
const DEFAULT_ZONE_PCTS = [
  { low: 0, high: 60 },
  { low: 60, high: 70 },
  { low: 70, high: 80 },
  { low: 80, high: 90 },
  { low: 90, high: 100 },
] as const;

const ZONE_META = [
  { label: "Zone 1", desc: "Recovery / very easy" },
  { label: "Zone 2", desc: "Easy aerobic / base" },
  { label: "Zone 3", desc: "Moderate / tempo" },
  { label: "Zone 4", desc: "Threshold" },
  { label: "Zone 5", desc: "Max / VO2" },
] as const;

const STEPS = ["About you", "Experience", "Schedule & goal", "Benchmarks"] as const;

/** Sports the engine can generate today (HYROX + the DEKA family). */
const SPORT_OPTIONS = [
  { value: "hyrox", label: "HYROX", blurb: "8×1km runs + 8 functional stations" },
  { value: "deka_fit", label: "DEKA FIT", blurb: "10 zones, each after a 500m run (5km total)" },
  { value: "deka_mile", label: "DEKA MILE", blurb: "10 zones + 1 mile of 160m sprints — short & fast" },
  { value: "deka_strong", label: "DEKA STRONG", blurb: "10 zones back-to-back, no running — strength-endurance" },
  { value: "deka_atlas", label: "DEKA ATLAS", blurb: "10 heavy barbell/DB zones, no running — strength-led" },
  { value: "deka_ultra", label: "DEKA ULTRA", blurb: "5× DEKA FIT — 25km + 50 zones (endurance)" },
  { value: "tri_70_3", label: "Ironman 70.3", blurb: "Half — 1.9km swim / 90km bike / 21.1km run" },
  { value: "tri_140_6", label: "Ironman 140.6", blurb: "Full — 3.8km swim / 180km bike / 42.2km run" },
  { value: "general_fitness", label: "General Fitness", blurb: "No race — rotating strength + cardio blocks for all-round fitness" },
] as const;

const SUBGOAL_OPTIONS = [
  { value: "balanced", label: "Balanced (default)" },
  { value: "general_strength", label: "Build strength" },
  { value: "general_endurance", label: "Build endurance" },
  { value: "recomp", label: "Fat loss / recomposition" },
] as const;

type ProgramType = "goal_event" | "fixed_duration" | "general_fitness";
type Race = { date: string; priority: "A" | "B" | "C" };
/** Internal row: a Race plus a stable client id used only as a React key, so
 *  removing a middle race can't misassociate controlled inputs (roadmap #1.7). */
type RaceRow = Race & { id: string };
const newRaceId = () => crypto.randomUUID();

/** Pre-fill values for edit mode (new-additions #1), derived from a program's
 *  stored input snapshot. */
export type EditInitial = {
  sport?: string;
  subGoal?: string;
  programType: ProgramType;
  races: Race[];
  durationWeeks: number;
  startDate: string;
  programName: string;
  startMileage?: number;
  startCardioMinutes?: number;
  benchmarks?: Record<string, string | number | undefined>;
  /** Triathlon per-discipline experience (edit-mode pre-fill). */
  swimExp?: string;
  bikeExp?: string;
};

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 focus:border-black focus:outline-none";

export default function OnboardingForm({
  profile,
  mode = "create",
  programId,
  initial,
}: {
  profile: ProfileRow | null;
  mode?: "create" | "edit";
  programId?: string;
  initial?: EditInitial;
}) {
  const isEdit = mode === "edit" && !!programId;
  const action = isEdit ? updateProgramInputs.bind(null, programId!) : submitOnboarding;
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // Timestamp of when the user reached the final step — used to ignore an
  // accidental click that lands on "Generate" right after advancing.
  const enteredLastStepAt = useRef(0);

  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [sport, setSport] = useState<string>(initial?.sport ?? "hyrox");
  const [subGoal, setSubGoal] = useState<string>(initial?.subGoal ?? "balanced");
  const sportBlurb = SPORT_OPTIONS.find((s) => s.value === sport)?.blurb ?? "";
  const isGeneralFitness = sport === "general_fitness";
  const isDeka = sport.startsWith("deka_");
  const isAtlas = sport === "deka_atlas";
  const isTriathlon = sport === "tri_70_3" || sport === "tri_140_6";
  // Only HYROX and DEKA Fit prescribe runs paced off a 5K, so only they require it.
  const requiresFiveK = sport === "hyrox" || sport === "deka_fit";

  const [days, setDays] = useState<string[]>(profile?.training_days ?? []);
  // Custom HR zones (new-additions #3) — off by default; standard bands preset.
  const [customZones, setCustomZones] = useState<boolean>(!!profile?.hr_zones);
  const [zones, setZones] = useState<{ low: number; high: number }[]>(() => {
    const hz = profile?.hr_zones;
    if (hz) return [hz.z1, hz.z2, hz.z3, hz.z4, hz.z5].map((b) => ({ low: b.low, high: b.high }));
    return DEFAULT_ZONE_PCTS.map((b) => ({ low: b.low, high: b.high }));
  });
  // Day-placement preferences (new-additions #4; lift/hybrid days Tasks #1).
  const [longRunDay, setLongRunDay] = useState<string>(profile?.day_preferences?.longRunDay ?? "");
  const [restDays, setRestDays] = useState<string[]>(profile?.day_preferences?.restDays ?? []);
  const [liftDays, setLiftDays] = useState<string[]>(profile?.day_preferences?.liftDays ?? []);
  const [hybridDays, setHybridDays] = useState<string[]>(profile?.day_preferences?.hybridDays ?? []);
  const [programType, setProgramType] = useState<ProgramType>(initial?.programType ?? "goal_event");
  const [races, setRaces] = useState<RaceRow[]>(
    (initial && initial.races.length > 0
      ? initial.races
      : [{ date: "", priority: "A" as const }]
    ).map((r) => ({ ...r, id: newRaceId() })),
  );
  const [duration, setDuration] = useState(initial?.durationWeeks ?? 12);
  const [startDate, setStartDate] = useState<string>(initial?.startDate ?? new Date().toISOString().slice(0, 10));

  const showRaces = programType === "goal_event" || programType === "fixed_duration";
  const showDuration = programType !== "goal_event";
  const today = new Date().toISOString().slice(0, 10);
  // In edit mode the program may have started in the past, so don't force
  // future-only dates (which would block keeping the original start / races).
  const minDate = isEdit ? undefined : today;

  function toggleDay(key: string) {
    const turningOff = days.includes(key);
    setDays((d) => (d.includes(key) ? d.filter((x) => x !== key) : [...d, key]));
    // Drop any day-preference that points at a day that's no longer selected.
    if (turningOff) {
      setRestDays((r) => r.filter((x) => x !== key));
      setLiftDays((r) => r.filter((x) => x !== key));
      setHybridDays((r) => r.filter((x) => x !== key));
      setLongRunDay((cur) => (cur === key ? "" : cur));
    }
  }

  function updateZone(i: number, patch: Partial<{ low: number; high: number }>) {
    setZones((zs) => zs.map((z, idx) => (idx === i ? { ...z, ...patch } : z)));
  }
  function toggleRestDay(key: string) {
    setRestDays((r) => (r.includes(key) ? r.filter((x) => x !== key) : [...r, key]));
  }
  function toggleLiftDay(key: string) {
    setLiftDays((r) => (r.includes(key) ? r.filter((x) => x !== key) : [...r, key]));
  }
  function toggleHybridDay(key: string) {
    setHybridDays((r) => (r.includes(key) ? r.filter((x) => x !== key) : [...r, key]));
  }

  function updateRace(i: number, patch: Partial<Race>) {
    setRaces((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRace() {
    setRaces((rs) => [...rs, { id: newRaceId(), date: "", priority: "B" }]);
  }
  function removeRace(i: number) {
    setRaces((rs) => rs.filter((_, idx) => idx !== i));
  }

  /**
   * Block implicit form submission on Enter: in a multi-step form a stray
   * Enter keypress would otherwise submit and jump straight to generation
   * before the user finishes (e.g. while typing benchmarks). Submission only
   * happens via the explicit "Generate program" button.
   */
  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    const target = e.target as HTMLElement;
    if (e.key === "Enter" && target.tagName !== "TEXTAREA") {
      e.preventDefault();
    }
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
    setStep((s) => {
      const nextStep = Math.min(s + 1, STEPS.length - 1);
      if (nextStep === STEPS.length - 1) enteredLastStepAt.current = Date.now();
      return nextStep;
    });
  }
  function back() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  /**
   * The ONLY path that starts generation. The form itself never submits
   * (native submit is blocked), so program creation can't be triggered by
   * Enter or by advancing into the Benchmarks step — only by a deliberate
   * click here, on the last step.
   */
  function handleGenerate() {
    if (step !== STEPS.length - 1) return;
    // Ignore a click that arrives within 300ms of reaching the last step
    // (guards against a double-click on "Next" carrying through to "Generate").
    if (Date.now() - enteredLastStepAt.current < 300) return;
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    // The dispatch from useActionState must run inside a transition when
    // invoked manually (rather than via a form action prop).
    startTransition(() => formAction(formData));
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-6"
    >
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
          What are you training for?
          <select
            name="sport"
            value={sport}
            onChange={(e) => {
              const v = e.target.value;
              setSport(v);
              // General fitness has no race; race sports default back to a goal event.
              setProgramType(v === "general_fitness" ? "general_fitness" : "goal_event");
            }}
            className={inputClass}
          >
            {SPORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-400">{sportBlurb}</span>
        </label>
        {isGeneralFitness && (
          <label className="flex flex-col gap-1 text-sm">
            Primary goal
            <select name="subGoal" value={subGoal} onChange={(e) => setSubGoal(e.target.value)} className={inputClass}>
              {SUBGOAL_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-zinc-400">Biases the emphasis rotation; all-round fitness stays the base.</span>
          </label>
        )}
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
        <label className="flex flex-col gap-1 text-sm">
          Sex <span className="text-xs text-zinc-400">(optional — improves max-HR estimate)</span>
          <select name="sex" defaultValue={profile?.sex ?? ""} className={inputClass}>
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </label>
        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Max heart rate <span className="text-xs text-zinc-400">(optional)</span>
            <input
              name="maxHr"
              type="number"
              min={100}
              max={230}
              defaultValue={profile?.max_hr ?? ""}
              placeholder="From age & sex"
              className={inputClass}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Resting HR <span className="text-xs text-zinc-400">(optional)</span>
            <input
              name="restingHr"
              type="number"
              min={25}
              max={120}
              defaultValue={profile?.resting_hr ?? ""}
              placeholder="e.g. 52"
              className={inputClass}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Threshold HR <span className="text-xs text-zinc-400">(optional)</span>
            <input
              name="thresholdHr"
              type="number"
              min={90}
              max={220}
              defaultValue={profile?.threshold_hr ?? ""}
              placeholder="e.g. 168"
              className={inputClass}
            />
          </label>
        </div>
        <p className="text-xs text-zinc-500">
          Max HR defaults to a sex-specific age formula (Tanaka / Gulati). Zones use the best data you
          give: a threshold HR (lactate-threshold / Friel zones), else a resting HR (heart-rate reserve),
          else % of max HR. Set a tested max HR if you know it.
        </p>

        {sport === "hyrox" && (
          <>
            <div className="flex gap-4">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                HYROX division <span className="text-xs text-zinc-400">(station loads)</span>
                <select name="division" defaultValue={profile?.division ?? "open"} className={inputClass}>
                  <option value="open">Open</option>
                  <option value="pro">Pro</option>
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Goal finish time <span className="text-xs text-zinc-400">(optional, m:ss or h:mm:ss)</span>
                <input
                  name="goalFinishTime"
                  type="text"
                  defaultValue={profile?.goal_finish_time ?? ""}
                  placeholder="e.g. 1:15:00"
                  className={inputClass}
                />
              </label>
            </div>
            <p className="text-xs text-zinc-500">
              Division sets the sled / carry / lunge / wall-ball race loads your hybrid sessions build toward.
              A goal time drives your race pacing plan — leave it blank and we predict one from your benchmarks.
            </p>
          </>
        )}

        {isDeka && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Goal finish time <span className="text-xs text-zinc-400">(optional, m:ss or h:mm:ss)</span>
              <input
                name="goalFinishTime"
                type="text"
                defaultValue={profile?.goal_finish_time ?? ""}
                placeholder="e.g. 42:00"
                className={inputClass}
              />
            </label>
            <p className="text-xs text-zinc-500">
              A goal time drives your zone-by-zone race pacing plan — leave it blank and we predict one from
              your run and erg benchmarks.
            </p>
          </>
        )}

        {/* Custom HR zones (new-additions #3) */}
        <fieldset className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={customZones} onChange={(e) => setCustomZones(e.target.checked)} />
            <span className="font-medium">Set custom heart-rate zones</span>
          </label>
          <p className="text-xs text-zinc-500">
            By default, zones use standard %-of-max bands (Z1 &lt;60, Z2 60–70, Z3 70–80, Z4 80–90, Z5 90–100).
            Enable this to set your own low/high % for each zone.
          </p>
          {/* Serialized flag the server action reads to know custom zones are on. */}
          <input type="hidden" name="hrZonesEnabled" value={customZones ? "on" : ""} />
          {customZones && (
            <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3">
              {ZONE_META.map((z, i) => (
                <div key={z.label} className="flex items-center gap-3">
                  <span className="w-32 shrink-0">
                    <span className="font-medium">{z.label}</span>
                    <span className="block text-xs text-zinc-500">{z.desc}</span>
                  </span>
                  <label className="flex items-center gap-1 text-xs text-zinc-500">
                    low %
                    <input
                      name={`zone_${i + 1}_low`}
                      type="number"
                      min={0}
                      max={100}
                      value={zones[i]!.low}
                      onChange={(e) => updateZone(i, { low: Number(e.target.value) })}
                      className="w-16 rounded-md border border-zinc-300 px-2 py-1 focus:border-black focus:outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-zinc-500">
                    high %
                    <input
                      name={`zone_${i + 1}_high`}
                      type="number"
                      min={0}
                      max={100}
                      value={zones[i]!.high}
                      onChange={(e) => updateZone(i, { high: Number(e.target.value) })}
                      className="w-16 rounded-md border border-zinc-300 px-2 py-1 focus:border-black focus:outline-none"
                    />
                  </label>
                </div>
              ))}
              <p className="text-xs text-zinc-500">Each zone&apos;s high % must be greater than its low %.</p>
            </div>
          )}
        </fieldset>
      </fieldset>

      {/* Step 2 — Experience. The axes are tailored to the program: triathlon
          asks swim + bike (not hybrid); every other sport asks hybrid. Required
          fields that aren't shown for this sport get a hidden neutral default. */}
      <fieldset className={`flex flex-col gap-6 ${step === 1 ? "" : "hidden"}`}>
        {(isTriathlon
          ? (["running", "swim", "bike", "lifting"] as const)
          : (["running", "hybrid", "lifting"] as const)
        ).map((key) => {
          const group = EXPERIENCE_DEFS[key];
          const fieldName = `${key}Exp`;
          const fallback = key === "swim" || key === "bike" ? "intermediate" : "beginner";
          const current =
            key === "running"
              ? profile?.running_exp
              : key === "hybrid"
                ? profile?.hybrid_exp
                : key === "lifting"
                  ? profile?.lifting_exp
                  : key === "swim"
                    ? initial?.swimExp
                    : initial?.bikeExp;
          return (
            <fieldset key={key} className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 font-medium">{group.label}</legend>
              {group.options.map((opt) => (
                <label key={opt.value} className="flex items-start gap-2 rounded-md border border-zinc-200 px-3 py-2">
                  <input type="radio" name={fieldName} value={opt.value} defaultChecked={(current ?? fallback) === opt.value} className="mt-1" />
                  <span>
                    <span className="font-medium">{opt.label}</span>
                    <span className="block text-xs text-zinc-500">{opt.def}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          );
        })}

        {/* Hybrid experience isn't asked for triathlon, but the schema requires it —
            submit a neutral default so validation passes and it stays inert. */}
        {isTriathlon && <input type="hidden" name="hybridExp" value="intermediate" />}

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
        <div className="flex flex-col gap-4 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Program name <span className="text-xs text-zinc-400">(optional)</span>
            <input name="programName" defaultValue={initial?.programName ?? ""} placeholder="e.g. Spring HYROX build" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Start date
            <input
              name="startDate"
              type="date"
              min={minDate}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">Training days (pick at least 3)</legend>
          <DayPills options={DAYS} selected={days} namePrefix="day" onToggle={toggleDay} />
          <span className="text-xs text-zinc-500">{days.length} selected</span>
        </fieldset>

        {/* Day-placement preferences (new-additions #4) */}
        <fieldset className="flex flex-col gap-3 text-sm">
          <legend className="mb-1 font-medium">
            Day preferences <span className="text-xs font-normal text-zinc-400">(optional)</span>
          </legend>
          {days.length === 0 ? (
            <p className="text-xs text-zinc-500">Pick your training days above to set day preferences.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                Preferred long-run day
                <select name="longRunDay" value={longRunDay} onChange={(e) => setLongRunDay(e.target.value)} className={inputClass}>
                  <option value="">No preference</option>
                  {DAYS.filter((d) => days.includes(d.key)).map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col gap-1">
                <span>Preferred rest day(s)</span>
                <DayPills options={DAYS.filter((d) => days.includes(d.key))} selected={restDays} namePrefix="restday" onToggle={toggleRestDay} />
                <span className="text-xs text-zinc-500">
                  Rest days are kept clear when your schedule leaves room. A long-run-day preference wins if the two conflict.
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span>Preferred strength / lifting day(s)</span>
                <DayPills options={DAYS.filter((d) => days.includes(d.key))} selected={liftDays} namePrefix="liftday" onToggle={toggleLiftDay} />
              </div>
              <div className="flex flex-col gap-1">
                <span>Preferred hybrid (HYROX) day(s)</span>
                <DayPills options={DAYS.filter((d) => days.includes(d.key))} selected={hybridDays} namePrefix="hybridday" onToggle={toggleHybridDay} />
                <span className="text-xs text-zinc-500">
                  We pin these workout types to your chosen days when the week has room — the long-run day is placed first, then hybrid, then lifting.
                </span>
              </div>
            </>
          )}
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

            {/* A/B/C race definitions */}
            <div className="flex flex-col gap-1 rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">
              <p>
                <span className="font-semibold text-zinc-800">A race</span> — your peak goal. Gets a full 2-week taper for
                maximum freshness (volume drops to ~60–70% then ~40–50% on race week; intensity stays sharp).
              </p>
              <p>
                <span className="font-semibold text-zinc-800">B race</span> — secondary. A mini-taper: the race week is cut
                ~40% while you keep your hard efforts, protecting training rhythm.
              </p>
              <p>
                <span className="font-semibold text-zinc-800">C race</span> — a tune-up or fitness test. No taper — you
                train right through it and treat the race itself as a hard workout.
              </p>
            </div>

            {races.map((r, i) => (
              <div key={r.id} className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1">
                  Date
                  <input type="date" min={minDate} value={r.date} onChange={(e) => updateRace(i, { date: e.target.value })} className={inputClass} />
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
              <div key={r.id}>
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

        {/* Starting volume overrides (optional) */}
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">Starting volume <span className="text-xs font-normal text-zinc-400">(optional)</span></legend>
          <p className="text-xs text-zinc-500">
            Leave blank to start from your running-experience default. Set these if you know your current weekly load and
            want the program to build from it.
          </p>
          <div className="flex gap-4">
            <label className="flex flex-1 flex-col gap-1">
              Starting weekly mileage
              <input name="startMileage" type="number" min={0} step="0.1" defaultValue={initial?.startMileage ?? ""} placeholder="e.g. 22" className={inputClass} />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              Starting weekly cardio (min)
              <input name="startCardioMinutes" type="number" min={0} step="1" defaultValue={initial?.startCardioMinutes ?? ""} placeholder="e.g. 350" className={inputClass} />
            </label>
          </div>
        </fieldset>
      </fieldset>

      {/* Step 4 — Benchmarks */}
      <fieldset className={`flex flex-col gap-5 ${step === 3 ? "" : "hidden"}`}>
        <p className="text-sm text-zinc-500">
          {requiresFiveK ? (
            <>
              Your <span className="font-medium text-zinc-700">5K time is required</span> — all run paces are calculated
              from it. If you don&apos;t know it, enter your best guess.{" "}
            </>
          ) : (
            <>All benchmarks are optional for this program. </>
          )}
          Add all benchmarks that you know. If you are unsure, you may add a best guess, but err on the side of
          conservative estimates to begin the program.
        </p>
        <div className="grid grid-cols-2 gap-4 text-sm">
          {([
            ["mileTime", "1-mile time (mm:ss)", "text"],
            ["fiveKTime", `5K time (mm:ss)${requiresFiveK ? " — required" : ""}`, "text"],
            ["tenKTime", "10K time (mm:ss)", "text"],
            ["ski2kTime", "2000m ski erg (mm:ss)", "text"],
            ["row2kTime", "2000m row erg (mm:ss)", "text"],
            ["fiveRmSquat", "5-rep max squat (lbs)", "number"],
            ["fiveRmBench", "5-rep max bench (lbs)", "number"],
            ["fiveRmDeadlift", "5-rep max deadlift (lbs)", "number"],
            ["bike20MinCals", "Assault bike cals / 20 min", "number"],
          ] as const).map(([name, label, type]) => (
            <label key={name} className="flex flex-col gap-1">
              {label}
              <input
                name={name}
                type={type === "number" ? "number" : "text"}
                step={type === "number" ? "1" : undefined}
                defaultValue={initial?.benchmarks?.[name] ?? ""}
                className={inputClass}
              />
            </label>
          ))}
        </div>

        {isAtlas && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-500">
              <span className="font-medium text-zinc-700">ATLAS anchors</span> — overhead-pressing endurance
              and a glycolytic test let us find your limiter (absolute strength comes from your barbell lifts
              above) and bias the program toward it.
            </p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <label className="flex flex-col gap-1">
                Max unbroken DB shoulder-to-overhead reps @ Rx
                <input
                  name="ohpEnduranceReps"
                  type="number"
                  step="1"
                  placeholder="e.g. 22"
                  defaultValue={initial?.benchmarks?.ohpEnduranceReps ?? ""}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                Glycolytic test — 21-15-9 thrusters &amp; burpees (mm:ss)
                <input
                  name="glycolyticTestSec"
                  type="text"
                  placeholder="e.g. 3:10"
                  defaultValue={initial?.benchmarks?.glycolyticTestSec ?? ""}
                  className={inputClass}
                />
              </label>
            </div>
          </div>
        )}

        {isTriathlon && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-500">
              <span className="font-medium text-zinc-700">Triathlon anchors</span> — your swim CSS pace and
              bike FTP unlock personalized swim-pace and bike-power zones (your 5K time drives run zones).
            </p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <label className="flex flex-col gap-1">
                Swim CSS pace (mm:ss / 100m)
                <input
                  name="cssPace"
                  type="text"
                  placeholder="e.g. 1:40"
                  defaultValue={initial?.benchmarks?.cssPace ?? ""}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                Bike FTP (watts)
                <input
                  name="ftpWatts"
                  type="number"
                  step="1"
                  placeholder="e.g. 240"
                  defaultValue={initial?.benchmarks?.ftpWatts ?? ""}
                  className={inputClass}
                />
              </label>
            </div>
          </div>
        )}
      </fieldset>

      {(stepError || state.error) && <p className="text-sm text-red-600">{stepError ?? state.error}</p>}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={back}
          disabled={step === 0}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-0"
        >
          ← Back
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={next} className="rounded-full bg-black px-6 py-2.5 text-white transition-colors hover:bg-zinc-800">
            Next
          </button>
        ) : (
          <button type="button" onClick={handleGenerate} disabled={pending} className="rounded-full bg-black px-6 py-2.5 text-white transition-colors hover:bg-zinc-800 disabled:opacity-50">
            {pending
              ? isEdit
                ? "Recalculating…"
                : "Building your program…"
              : isEdit
                ? "Save & recalculate"
                : "Generate program"}
          </button>
        )}
      </div>
    </form>
  );
}
