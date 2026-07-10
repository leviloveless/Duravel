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
 * Onboarding submit handler (architecture-plan.md §7).
 *
 * Assembles the full 4-step intake into a validated GenerationInput,
 * persists the profile (with optional benchmarks), runs the deterministic
 * periodization engine (Milestone 3) to store the program skeleton, and
 * creates a `programs` row (+ `races`) in the `generating` state. The AI
 * session fill (Milestone 5) picks up from there.
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
  const input: GenerationInput = parsed.data;

  if (input.programType === "goal_event" && (!input.races || input.races.length === 0)) {
    return { error: "Add at least one race date for a goal-event program." };
  }
  if (input.programType !== "goal_event" && !input.durationWeeks) {
    return { error: "Choose a program length (4–24 weeks)." };
  }

  // --- Deterministic periodization engine (Milestone 3) ---
  const start = input.startDate ?? todayISO();
  const engineInput = toEngineInput(input, start);
  const skeleton = buildSkeleton(engineInput);

  // Program name: user-supplied, or a sensible default.
  const TYPE_LABEL: Record<string, string> = {
    goal_event: "goal event",
    fixed_duration: "fixed duration",
    general_fitness: "general fitness",
  };
  const programName =
    str(formData, "programName") ??
    `${engineInput.durationWeeks}-week ${TYPE_LABEL[input.programType] ?? input.programType} program`;

  // --- Persist profile ---
  const { error: profileError } = await supabase.from("profiles").upsert({
    id: user.id,
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
    updated_at: new Date().toISOString(),
  });
  if (profileError) return { error: profileError.message };

  // --- Create program row ---
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

  // --- Persist races (calendar dates) ---
  if (input.races && input.races.length > 0) {
    const { error: racesError } = await supabase.from("races").insert(
      input.races.map((r) => ({
        program_id: program.id,
        race_date: r.raceDate,
        priority: r.priority,
      })),
    );
    if (racesError) return { error: racesError.message };
  }

  revalidatePath("/dashboard");
  redirect(`/program/${program.id}`);
}
