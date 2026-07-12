import { createClient } from "@/lib/supabase/server";

/** Row shape from the `profiles` table (see supabase/migrations/0001_init.sql). */
export type ProfileRow = {
  id: string;
  first_name: string;
  age: number;
  body_weight: number;
  weight_unit: "lbs" | "kg";
  running_exp: "beginner" | "intermediate" | "advanced";
  hybrid_exp: "beginner" | "intermediate" | "advanced";
  lifting_exp: "beginner" | "intermediate" | "advanced";
  training_class: "non_highly_trained" | "highly_trained";
  training_days: string[];
  benchmarks: Record<string, unknown> | null;
  /** Optional custom max HR (bpm); null → use 220 − age (new-additions #2). */
  max_hr: number | null;
  /** Optional custom HR zone bands as % of max HR (new-additions #3). */
  hr_zones: Record<"z1" | "z2" | "z3" | "z4" | "z5", { low: number; high: number }> | null;
  /** Optional day-placement preferences (new-additions #4). */
  day_preferences: { longRunDay?: string; restDays?: string[] } | null;
  created_at: string;
  updated_at: string;
};

export async function getCurrentProfile(): Promise<ProfileRow | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

/** Summary row for the dashboard program list. */
export type ProgramSummaryRow = {
  id: string;
  name: string | null;
  program_type: "goal_event" | "fixed_duration" | "general_fitness";
  duration_weeks: number;
  status: "generating" | "ready" | "failed";
  start_date: string;
  created_at: string;
};

/** Row shape from `workout_logs` (Phase 2 — supabase/migrations/0005). */
export type WorkoutLogRow = {
  id: string;
  program_id: string;
  week_number: number;
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  session_index: number;
  status: "completed" | "partial" | "skipped";
  rpe: number | null;
  actuals: { durationMin?: number; distanceMiles?: number; avgHr?: number } | null;
  note: string | null;
  logged_at: string;
  updated_at: string;
};

export async function getProgramLogs(programId: string): Promise<WorkoutLogRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workout_logs")
    .select("id, program_id, week_number, day, session_index, status, rpe, actuals, note, logged_at, updated_at")
    .eq("program_id", programId)
    .order("week_number", { ascending: true });
  return (data as WorkoutLogRow[] | null) ?? [];
}

/** Row shape from `adaptations` (Phase 2 — supabase/migrations/0006). */
export type AdaptationRow = {
  id: string;
  program_id: string;
  week_number: number;
  target_week: number;
  decision: "applied" | "dismissed";
  rule_applied: string;
  signals: Record<string, unknown> | null;
  revised_targets: Record<string, unknown> | null;
  created_at: string;
};

export async function getProgramAdaptations(programId: string): Promise<AdaptationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("adaptations")
    .select("id, program_id, week_number, target_week, decision, rule_applied, signals, revised_targets, created_at")
    .eq("program_id", programId)
    .order("week_number", { ascending: true });
  return (data as AdaptationRow[] | null) ?? [];
}

export async function getUserPrograms(): Promise<ProgramSummaryRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("programs")
    .select("id, name, program_type, duration_weeks, status, start_date, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (data as ProgramSummaryRow[] | null) ?? [];
}
