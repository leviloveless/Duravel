import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { GenerationInput } from "@/lib/schemas";
import type { ProfileRow } from "@/lib/supabase/queries";
import OnboardingForm, { type EditInitial } from "@/app/onboarding/onboarding-form";

/**
 * Edit a program's original build inputs, then recalculate (new-additions #1).
 *
 * Loads the program's stored `input_snapshot` and pre-fills the same build form
 * used at onboarding. Saving rewrites the snapshot and regenerates the program
 * from the new inputs.
 */
export default async function EditProgramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, duration_weeks, start_date, input_snapshot")
    .eq("id", id)
    .single();

  if (!program) {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-24 sm:px-6">
        <h1 className="text-2xl font-semibold">Program not found</h1>
        <Link href="/dashboard" className="text-sm underline">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const snap = program.input_snapshot as GenerationInput;
  const p = snap.profile;

  // The build form reads a ProfileRow (snake_case); rebuild one from the snapshot
  // so the athlete's original answers pre-fill exactly as they entered them.
  const profileRow: ProfileRow = {
    id: user.id,
    first_name: p.firstName,
    age: p.age,
    body_weight: p.bodyWeight,
    weight_unit: p.weightUnit,
    running_exp: p.runningExp,
    hybrid_exp: p.hybridExp,
    lifting_exp: p.liftingExp,
    training_class: p.trainingClass,
    training_days: p.trainingDays,
    benchmarks: (p.benchmarks as Record<string, unknown> | undefined) ?? null,
    sex: p.sex ?? null,
    max_hr: p.maxHr ?? null,
    resting_hr: p.restingHr ?? null,
    threshold_hr: p.thresholdHr ?? null,
    division: p.division ?? null,
    goal_finish_time: p.goalFinishTime ?? null,
    hr_zones: p.hrZones ?? null,
    day_preferences: p.dayPreferences ?? null,
    created_at: "",
    updated_at: "",
  };

  const initial: EditInitial = {
    programType: snap.programType,
    races: (snap.races ?? []).map((r) => ({ date: r.raceDate, priority: r.priority })),
    durationWeeks: snap.durationWeeks ?? program.duration_weeks,
    startDate: snap.startDate ?? program.start_date,
    programName: program.name ?? "",
    startMileage: snap.startMileage,
    startCardioMinutes: snap.startCardioMinutes,
    benchmarks: (p.benchmarks as Record<string, string | number | undefined> | undefined) ?? undefined,
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Edit program inputs</h1>
          <p className="text-sm text-zinc-500">
            Change any of your original answers, then save to recalculate the program from the new inputs.
          </p>
        </div>
        <Link href={`/program/${id}`} className="text-sm underline">
          Cancel
        </Link>
      </div>
      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Saving replaces the current sessions with a freshly generated program. Any logged workouts stay attached to their
        week numbers.
      </p>
      <OnboardingForm profile={profileRow} mode="edit" programId={id} initial={initial} />
    </main>
  );
}
