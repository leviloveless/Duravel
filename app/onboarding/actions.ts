"use server";

import { createClient } from "@/lib/supabase/server";
import { GenerationInputSchema, type GenerationInput } from "@/lib/schemas";
import { toEngineInput, buildSkeleton } from "@/lib/engine";
import { PHILOSOPHY_VERSION } from "@/lib/ai/philosophy";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export type OnboardingState = { error: string | null };

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Read a form value as a trimmed string, or undefined when blank. */
function str(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Read a form value as a number, or undefined when blank / not a number. */
function num(formData: FormData, key: string): number | undefined {
  const s = str(formData, key);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parse + validate the build-program form (shared by create and edit) into a
 * GenerationInput. Returns either the input (+ the raw program-name field) or a
 * user-facing error message.
 */
function parseGenerationInput(
  formData: FormData,
): { input: GenerationInput; programNameInput?: string; error?: undefined } | { error: string; input?: undefined } {
  // --- Benchmarks (all optional) ---
  const benchmarksRaw = {
    mileTime: str(formData, "mileTime"),
    fiveKTime: str(formData, "fiveKTime"),
    tenKTime: str(formData, "tenKTime"),
    fiveRmSquat: num(formData, "fiveRmSquat"),
    fiveRmBench: num(formData, "fiveRmBench"),
    fiveRmDeadlift: num(formData, "fiveRmDeadlift"),
    ski2kTime: str(formData, "ski2kTime"),
    row2kTime: str(formData, "row2kTime"),
    bike20MinCals: num(formData, "bike20MinCals"),
  };
  const hasBenchmark = Object.values(benchmarksRaw).some((v) => v !== undefined);
  const benchmarks = hasBenchmark ? benchmarksRaw : undefined;

  // --- Training days multi-select ---
  const trainingDays = DAY_KEYS.filter((d) => formData.get(`day_${d}`) === "on");

  // --- Custom max HR (optional; blank → 220 − age) (new-additions #2) ---
  const maxHr = num(formData, "maxHr");

  // --- Custom HR zone bands (optional) (new-additions #3) ---
  const zonesEnabled = formData.get("hrZonesEnabled") === "on";
  const zoneBand = (n: number) => ({ low: num(formData, `zone_${n}_low`), high: num(formData, `zone_${n}_high`) });
  const hrZones = zonesEnabled
    ? { z1: zoneBand(1), z2: zoneBand(2), z3: zoneBand(3), z4: zoneBand(4), z5: zoneBand(5) }
    : undefined;

  // --- Day-placement preferences (optional) (new-additions #4) ---
  const longRunDay = str(formData, "longRunDay");
  const restDays = DAY_KEYS.filter((d) => formData.get(`restday_${d}`) === "on");
  const dayPreferences =
    longRunDay || restDays.length > 0
      ? { longRunDay: longRunDay || undefined, restDays: restDays.length > 0 ? restDays : undefined }
      : undefined;

  // --- Program type + conditional race / duration inputs ---
  const programType = formData.get("programType");
  const raceCount = num(formData, "race_count") ?? 0;
  const races: { raceDate: string; priority: "A" | "B" | "C" }[] = [];
  for (let i = 0; i < raceCount; i++) {
    const date = str(formData, `race_date_${i}`);
    const priority = str(formData, `race_priority_${i}`) as "A" | "B" | "C" | undefined;
    if (date && priority) races.push({ raceDate: date, priority });
  }

  // Duration: derived from the goal race for goal_event; explicit otherwise.
  const durationWeeks = programType === "goal_event" ? undefined : num(formData, "durationWeeks");

  const candidate = {
    profile: {
      firstName: str(formData, "firstName"),
      age: num(formData, "age"),
      bodyWeight: num(formData, "bodyWeight"),
      weightUnit: formData.get("weightUnit"),
      runningExp: formData.get("runningExp"),
      hybridExp: formData.get("hybridExp"),
      liftingExp: formData.get("liftingExp"),
      trainingClass: formData.get("trainingClass"),
      trainingDays,
      benchmarks,
      maxHr,
      hrZones,
      dayPreferences,
    },
    programType,
    durationWeeks,
    races: races.length > 0 ? races : undefined,
    startMileage: num(formData, "startMileage"),
    startCardioMinutes: num(formData, "startCardioMinutes"),
    startDate: str(formData, "startDate"),
  };

  const parsed = GenerationInputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your answers and try again." };
  }
  const input = parsed.data;

  if (input.programType === "goal_event" && (!input.races || input.races.length === 0)) {
    return { error: "Add at least one race date for a goal-event program." };
  }
  if (input.programType !== "goal_event" && !input.durationWeeks) {
    return { error: "Choose a program length (4–24 weeks)." };
  }

  return { input, programNameInput: str(formData, "programName") };
}

/** The `profiles` upsert row derived from a validated GenerationInput. */
function profileUpsertRow(userId: string, input: GenerationInput) {
  return {
    id: userId,
    first_name: input.profile.firstName,
    age: input.profile.age,
    body_weight: input.profile.bodyWeight,
    weight_unit: input.profile.weightUnit,
    running_exp: input.profile.runningExp,
    hybrid_exp: input.profile.hybridExp,
    lifting_exp: input.profile.liftingExp,
    training_class: input.profile.trainingClass,
    training_days: input.profile.trainingDays,
    benchmarks: input.profile.benchmarks ?? null,
    max_hr: input.profile.maxHr ?? null,
    hr_zones: input.profile.hrZones ?? null,
    day_preferences: input.profile.dayPreferences ?? null,
    updated_at: new Date().toISOString(),
  };
}

const TYPE_LABEL: Record<string, string> = {
  goal_event: "goal event",
  fixed_duration: "fixed duration",
  general_fitness: "general fitness",
};

function defaultProgramName(input: GenerationInput, durationWeeks: number): string {
  return `${durationWeeks}-week ${TYPE_LABEL[input.programType] ?? input.programType} program`;
}

/**
 * Onboarding submit handler (architecture-plan.md §7).
 *
 * Assembles the full 4-step intake into a validated GenerationInput, persists
 * the profile, runs the deterministic periodization engine to store the program
 * skeleton, and creates a `programs` row (+ `races`) in the `generating` state.
 * The AI session fill picks up from there.
 */
export async function submitOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const parsed = parseGenerationInput(formData);
  if (!parsed.input) return { error: parsed.error ?? "Please check your answers and try again." };
  const input = parsed.input;

  const start = input.startDate ?? todayISO();
  const engineInput = toEngineInput(input, start);
  const skeleton = buildSkeleton(engineInput);
  const programName = parsed.programNameInput ?? defaultProgramName(input, engineInput.durationWeeks);

  const { error: profileError } = await supabase.from("profiles").upsert(profileUpsertRow(user.id, input));
  if (profileError) return { error: profileError.message };

  const { data: program, error: programError } = await supabase
    .from("programs")
    .insert({
      user_id: user.id,
      name: programName,
      program_type: input.programType,
      duration_weeks: engineInput.durationWeeks,
      start_date: start,
      status: "generating",
      skeleton,
      input_snapshot: input,
      philosophy_version: PHILOSOPHY_VERSION,
    })
    .select("id")
    .single();
  if (programError || !program) {
    return { error: programError?.message ?? "Could not create your program." };
  }

  if (input.races && input.races.length > 0) {
    const { error: racesError } = await supabase.from("races").insert(
      input.races.map((r) => ({ program_id: program.id, race_date: r.raceDate, priority: r.priority })),
    );
    if (racesError) return { error: racesError.message };
  }

  revalidatePath("/dashboard");
  redirect(`/program/${program.id}`);
}

/**
 * Edit an existing program's build inputs and recalculate (new-additions #1).
 *
 * Re-uses the same build-program form; instead of creating a new program it
 * rewrites this program's `input_snapshot` (+ name, type, duration, start date,
 * races) and resets it to `generating` with the freshly rebuilt skeleton. The
 * redirect back to the program page auto-triggers regeneration from the new
 * inputs (same path the plain Recalculate button uses).
 */
export async function updateProgramInputs(
  programId: string,
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  // Ownership check (RLS also scopes this to the caller's own rows).
  const { data: existing } = await supabase.from("programs").select("id").eq("id", programId).single();
  if (!existing) return { error: "Program not found." };

  const parsed = parseGenerationInput(formData);
  if (!parsed.input) return { error: parsed.error ?? "Please check your answers and try again." };
  const input = parsed.input;

  const start = input.startDate ?? todayISO();
  const engineInput = toEngineInput(input, start);
  const skeleton = buildSkeleton(engineInput);
  const programName = parsed.programNameInput ?? defaultProgramName(input, engineInput.durationWeeks);

  const { error: profileError } = await supabase.from("profiles").upsert(profileUpsertRow(user.id, input));
  if (profileError) return { error: profileError.message };

  const { error: updateError } = await supabase
    .from("programs")
    .update({
      name: programName,
      program_type: input.programType,
      duration_weeks: engineInput.durationWeeks,
      start_date: start,
      status: "generating",
      program_data: null,
      skeleton,
      input_snapshot: input,
      philosophy_version: PHILOSOPHY_VERSION,
    })
    .eq("id", programId);
  if (updateError) return { error: updateError.message };

  // Replace the program's race rows with the edited set.
  await supabase.from("races").delete().eq("program_id", programId);
  if (input.races && input.races.length > 0) {
    const { error: racesError } = await supabase.from("races").insert(
      input.races.map((r) => ({ program_id: programId, race_date: r.raceDate, priority: r.priority })),
    );
    if (racesError) return { error: racesError.message };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/program/${programId}`);
  redirect(`/program/${programId}`);
}
