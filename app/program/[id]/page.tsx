import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ProgramData, WorkoutLog } from "@/lib/schemas";
import { getProgramAdaptations, getProgramLogs, getProgramReadiness } from "@/lib/supabase/queries";
import { weekStartDate, type ZoneBands } from "@/components/program/format";
import { resolveHrModel, type Sex } from "@/lib/zones";
import ProgramView, { type ProgramActivity } from "@/components/program/program-view";
import PacingCard from "@/components/program/pacing-card";
import ReadinessForm from "@/components/program/readiness-form";
import { computePacingPlan } from "@/lib/engine/pacing";
import GenerateTrigger from "./generate-trigger";

/** Snapshot profile fields we read for HR personalization (new-additions #2, #3). */
type SnapshotProfile = {
  age?: number;
  sex?: Sex;
  maxHr?: number;
  restingHr?: number;
  thresholdHr?: number;
  hrZones?: Record<"z1" | "z2" | "z3" | "z4" | "z5", { low: number; high: number }>;
  benchmarks?: {
    mileTime?: string; fiveKTime?: string; tenKTime?: string;
    ski2kTime?: string; row2kTime?: string;
  };
  division?: "open" | "pro";
  goalFinishTime?: string;
};

/** Convert stored %-of-max zone bands (0–100) into ZoneBands fractions (0–1). */
function toZoneBands(hrZones: SnapshotProfile["hrZones"]): ZoneBands | undefined {
  if (!hrZones) return undefined;
  const z = (k: "z1" | "z2" | "z3" | "z4" | "z5") => ({
    low: hrZones[k].low / 100,
    high: hrZones[k].high / 100,
  });
  return { 1: z("z1"), 2: z("z2"), 3: z("z3"), 4: z("z4"), 5: z("z5") };
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

// A program still 'generating' this long after its last generation run started
// was almost certainly killed mid-flight (the route's maxDuration is 60s) before
// its own failure handler could run. We flip it to 'failed' on view so the user
// gets a retry path instead of an endless spinner (roadmap #1.8).
const STUCK_GENERATION_MS = 3 * 60 * 1000;

/** Number of program weeks that have fully ended as of now. */
function elapsedWeeks(startDate: string): number {
  const wk1 = weekStartDate(startDate, 1);
  return Math.max(0, Math.floor((Date.now() - wk1.getTime()) / MS_PER_WEEK));
}

export default async function ProgramPage({
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
    .select("id, name, status, duration_weeks, program_type, start_date, program_data, input_snapshot")
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

  const data = program.program_data as ProgramData | null;

  // Recover programs stuck in 'generating' (function killed before its failure
  // handler ran). If the most recent generation run for this program started
  // longer ago than the stuck threshold, mark it failed so the view offers a
  // retry instead of spinning forever.
  let status = program.status;
  if (status === "generating") {
    const { data: lastEvent } = await supabase
      .from("generation_events")
      .select("created_at")
      .eq("program_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const startedMs = lastEvent ? new Date(lastEvent.created_at).getTime() : null;
    if (startedMs !== null && Date.now() - startedMs > STUCK_GENERATION_MS) {
      await supabase.from("programs").update({ status: "failed" }).eq("id", id).eq("user_id", user.id);
      status = "failed";
    }
  }

  // Per-session HR zone ranges use the best-available anchoring (Review #3):
  // custom bands → threshold-HR (LTHR) → resting-HR (HRR) → sex-specific %HRmax.
  const snapshotProfile = (program.input_snapshot as { profile?: SnapshotProfile } | null)?.profile;
  const hrModel = resolveHrModel({
    age: snapshotProfile?.age,
    sex: snapshotProfile?.sex,
    maxHr: snapshotProfile?.maxHr,
    restingHr: snapshotProfile?.restingHr,
    thresholdHr: snapshotProfile?.thresholdHr,
    customBands: toZoneBands(snapshotProfile?.hrZones),
  });
  const maxHR = hrModel.maxHR;
  const zoneBands: ZoneBands = hrModel.bands;

  // Race pacing plan (Review #6): from the athlete's benchmarks + optional goal.
  const pacingPlan = computePacingPlan({
    benchmarks: snapshotProfile?.benchmarks,
    sex: snapshotProfile?.sex,
    division: snapshotProfile?.division,
    goalFinishTime: snapshotProfile?.goalFinishTime,
  });

  if (status === "ready" && data) {
    // Phase 2: logs + adaptation state for the review banner, badges and actuals.
    const [logRows, adaptations, readinessRows] = await Promise.all([
      getProgramLogs(program.id),
      getProgramAdaptations(program.id),
      getProgramReadiness(program.id),
    ]);
    const logs: WorkoutLog[] = logRows.map((r) => ({
      weekNumber: r.week_number,
      day: r.day,
      sessionIndex: r.session_index,
      status: r.status,
      rpe: r.rpe,
      actuals: r.actuals,
      note: r.note,
    }));

    // The review candidate: the most recent unreviewed week that still has a
    // week after it to adapt, and that is EITHER fully logged (every planned
    // session has a log — new-additions #7) OR has fully elapsed on the
    // calendar. Fully-logging a week lets the user recalculate the next week
    // right away, without waiting for the calendar.
    const reviewed = new Set(adaptations.map((a) => a.week_number));
    const elapsed = elapsedWeeks(program.start_date);
    const maxReviewable = program.duration_weeks - 1; // must have a following week

    const loggedByWeek = new Map<number, Set<string>>();
    for (const l of logs) {
      const set = loggedByWeek.get(l.weekNumber) ?? new Set<string>();
      set.add(`${l.day}:${l.sessionIndex}`);
      loggedByWeek.set(l.weekNumber, set);
    }
    const isFullyLogged = (w: number): boolean => {
      const wk = data.weeks.find((x) => x.weekNumber === w);
      if (!wk) return false;
      const planned: string[] = [];
      for (const d of wk.days) {
        d.sessions.forEach((s, i) => {
          if (s.kind !== "race") planned.push(`${d.day}:${i}`);
        });
      }
      if (planned.length === 0) return false; // race/rest-only week: nothing to review
      const logged = loggedByWeek.get(w) ?? new Set<string>();
      return planned.every((k) => logged.has(k));
    };

    let reviewWeek: number | null = null;
    for (let w = maxReviewable; w >= 1; w--) {
      if (reviewed.has(w)) continue;
      if (w <= elapsed || isFullyLogged(w)) {
        reviewWeek = w;
        break;
      }
    }

    const activity: ProgramActivity = {
      logs,
      frozenWeeks: adaptations.filter((a) => a.decision === "applied").map((a) => a.week_number),
      adaptedWeeks: adaptations
        .filter((a) => a.decision === "applied" && a.rule_applied !== "none")
        .map((a) => a.target_week),
      reviewWeek,
    };

    const readinessWeek = Math.min(
      program.duration_weeks,
      Math.max(1, elapsedWeeks(program.start_date) + 1),
    );
    const existingReadiness = readinessRows.find((r) => r.week_number === readinessWeek) ?? null;

    return (
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <PacingCard plan={pacingPlan} />
        <ReadinessForm programId={program.id} weekNumber={readinessWeek} existing={existingReadiness} />
        <ProgramView
          program={data}
          meta={{
            programId: program.id,
            name: program.name ?? "Your training program",
            durationWeeks: program.duration_weeks,
            programType: program.program_type,
            startDate: program.start_date,
            maxHR,
            zoneBands,
          }}
          activity={activity}
        />
      </main>
    );
  }

  // Not ready yet: run (or retry) generation.
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{program.name ?? "Your program"}</h1>
        <Link href="/dashboard" className="text-sm underline">
          Dashboard
        </Link>
      </div>
      <p className="text-sm text-zinc-500">
        {program.duration_weeks}-week {program.program_type.replace("_", " ")} program.
      </p>
      <GenerateTrigger programId={program.id} initialStatus={status === "failed" ? "failed" : "generating"} />
    </main>
  );
}
