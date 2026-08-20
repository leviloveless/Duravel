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
  /** Optional biological sex — drives the sex-specific max-HR formula (Review #3). */
  sex: "male" | "female" | "other" | null;
  /** Optional tested max HR (bpm); null → sex-specific age formula (Review #3). */
  max_hr: number | null;
  /** Optional resting HR (bpm) — enables %HRR (Karvonen) zones (Review #3). */
  resting_hr: number | null;
  /** Optional lactate-threshold HR (bpm) — enables %LTHR (Friel) zones (Review #3). */
  threshold_hr: number | null;
  /** Target HYROX division (Open/Pro) — drives station race loads (Review #6). */
  division: "open" | "pro" | null;
  /** Optional goal HYROX finish time (e.g. "1:15:00") for the pacing plan (Review #6). */
  goal_finish_time: string | null;
  /** Optional custom HR zone bands as % of max HR (new-additions #3). */
  hr_zones: Record<"z1" | "z2" | "z3" | "z4" | "z5", { low: number; high: number }> | null;
  /** Optional day-placement preferences (new-additions #4; lift/hybrid days Tasks #1). */
  day_preferences: {
    /** @deprecated superseded by longRunDays; still read for profiles saved earlier. */
    longRunDay?: string;
    longRunDays?: string[];
    restDays?: string[];
    liftDays?: string[];
    hybridDays?: string[];
  } | null;
  /** Equipment the athlete has available (Tasks #17). */
  equipment: string[] | null;
  /** How many days per week they currently train (Tasks #17). */
  current_days_per_week: number | null;
  /** IANA time zone from the browser (migration 0039). NULL until captured;
   *  every reader falls back to UTC. */
  timezone: string | null;
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
  /** Day the session was actually done when moved off the planned day (#5); null = as planned. */
  actual_day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" | null;
  logged_at: string;
  updated_at: string;
};

export async function getProgramLogs(programId: string): Promise<WorkoutLogRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workout_logs")
    .select("id, program_id, week_number, day, session_index, status, rpe, actuals, note, actual_day, logged_at, updated_at")
    .eq("program_id", programId)
    .order("week_number", { ascending: true });
  return (data as WorkoutLogRow[] | null) ?? [];
}

/** Row shape from `extra_workouts` (supabase/migrations/0038). */
export type ExtraWorkoutRow = {
  id: string;
  program_id: string;
  week_number: number;
  day: string;
  kind: "run" | "lift" | "hybrid" | "cardio" | "other";
  title: string | null;
  duration_min: number | null;
  distance_miles: number | string | null;
  avg_hr: number | null;
  goal_zone: number | null;
  rpe: number | null;
  note: string | null;
  activity_id: string | null;
  /** Set once this extra has been pushed to Strava (migration 0044). */
  strava_activity_id: string | null;
  created_at: string;
};

const EXTRA_COLUMNS =
  "id, program_id, week_number, day, kind, title, duration_min, distance_miles, avg_hr, goal_zone, rpe, note, activity_id, created_at";

/**
 * Every unplanned workout the athlete added to this program, oldest first so a
 * day's extras render in the order they were logged. Read-own via RLS.
 *
 * `strava_activity_id` (migration 0044) is selected defensively, the same way
 * `profiles.timezone` is in `strava-autopost.ts`: a deploy that lands before the
 * migration is applied would 400 on the unknown column, and because this query
 * swallows its error into `?? []` the failure would show up as the athlete's
 * extras silently VANISHING from the program page — not as an error anyone could
 * read. Migrations here are applied by hand, so that window is real.
 */
export async function getProgramExtras(programId: string): Promise<ExtraWorkoutRow[]> {
  const supabase = await createClient();
  const withStrava = await supabase
    .from("extra_workouts")
    .select(`${EXTRA_COLUMNS}, strava_activity_id`)
    .eq("program_id", programId)
    .order("created_at", { ascending: true });
  if (!withStrava.error) return (withStrava.data as ExtraWorkoutRow[] | null) ?? [];

  const { data } = await supabase
    .from("extra_workouts")
    .select(EXTRA_COLUMNS)
    .eq("program_id", programId)
    .order("created_at", { ascending: true });
  return (data as ExtraWorkoutRow[] | null) ?? [];
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

export type ReadinessCheckinRow = {
  week_number: number;
  sleep: number;
  fatigue: number;
  stress: number;
  soreness: number;
  resting_hr: number | null;
  hrv: number | null;
};

/** All readiness check-ins for a program (Review #7). */
export async function getProgramReadiness(programId: string): Promise<ReadinessCheckinRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("readiness_checkins")
    .select("week_number, sleep, fatigue, stress, soreness, resting_hr, hrv")
    .eq("program_id", programId)
    .order("week_number", { ascending: true });
  return (data as ReadinessCheckinRow[] | null) ?? [];
}

export type DailyMetricRow = {
  date: string; // "YYYY-MM-DD"
  resting_hr: number | null;
  hrv: number | null;
};

/** All daily resting-HR/HRV rows for the signed-in user (Tasks addition #7). */
export async function getDailyMetrics(): Promise<DailyMetricRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("daily_metrics")
    .select("date, resting_hr, hrv")
    .eq("user_id", user.id)
    .order("date", { ascending: true });
  return (data as DailyMetricRow[] | null) ?? [];
}
