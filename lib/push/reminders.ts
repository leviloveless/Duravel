import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProgramData, WorkoutLog } from "@/lib/schemas";
import { weekStartDate } from "@/components/program/format";
import { sendPushToUser } from "@/lib/push/send";
import { DAY_KEYS, unloggedSessionsToday, weekHasActivity } from "./triggers";

/**
 * Push workout-reminder flow — the trigger side of web push. Run from the daily
 * lifecycle cron (app/api/cron/lifecycle) with a service-role admin client.
 *
 * For each user who has a web push subscription and an active, in-progress
 * program, it fires up to two reminders:
 *   - workout_due  — there are unlogged sessions scheduled for today.
 *   - week_review  — it's the first day of a new program week and the week that
 *                    just ended had logged activity worth reviewing.
 *
 * The opt-in IS the subscription: turning "Workout reminders" off in Settings
 * deletes the row, so this flow simply finds nothing to send. Each send is
 * claimed in push_sends (migration 0037) with an idempotent dedup key, so a
 * re-run or partial cron never double-notifies. Time-of-day comes from the cron
 * schedule (14:00 UTC); per-user quiet hours are a follow-up (needs a profile
 * timezone column — none exists yet).
 */

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export interface PushRemindersSummary {
  subscribers: number;
  activePrograms: number;
  workoutDue: number;
  weekReview: number;
  sent: number;
  skippedDup: number;
  noSubscription: number;
  failed: number;
}

interface ProgramRow {
  id: string;
  user_id: string;
  name: string | null;
  duration_weeks: number;
  start_date: string;
  program_data: ProgramData | null;
}

interface Candidate {
  userId: string;
  kind: "workout_due" | "week_review";
  dedupKey: string;
  title: string;
  body: string;
  url: string;
  tag: string;
}

export async function runPushRemindersFlow(
  admin: SupabaseClient,
  nowMs: number,
): Promise<PushRemindersSummary> {
  const summary: PushRemindersSummary = {
    subscribers: 0,
    activePrograms: 0,
    workoutDue: 0,
    weekReview: 0,
    sent: 0,
    skippedDup: 0,
    noSubscription: 0,
    failed: 0,
  };
  // 1. Users with at least one web push subscription — the only ones reachable.
  const { data: subRows } = await admin
    .from("push_subscriptions")
    .select("user_id")
    .eq("platform", "web");
  const subscriberIds = Array.from(
    new Set(((subRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
  );
  summary.subscribers = subscriberIds.length;
  if (subscriberIds.length === 0) return summary;

  // 2. Their ready programs, newest first — pick each user's active in-progress one.
  const { data: progRows } = await admin
    .from("programs")
    .select("id, user_id, name, duration_weeks, start_date, program_data")
    .in("user_id", subscriberIds)
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  const activeByUser = new Map<string, { program: ProgramRow; startMs: number; currentWeek: number }>();
  for (const p of (progRows ?? []) as ProgramRow[]) {
    if (activeByUser.has(p.user_id)) continue; // newest active wins
    if (!p.program_data) continue;
    const startMs = weekStartDate(p.start_date, 1).getTime();
    if (nowMs < startMs || nowMs >= startMs + p.duration_weeks * MS_PER_WEEK) continue;
    const currentWeek = Math.min(
      p.duration_weeks,
      Math.floor((nowMs - startMs) / MS_PER_WEEK) + 1,
    );
    activeByUser.set(p.user_id, { program: p, startMs, currentWeek });
  }
  summary.activePrograms = activeByUser.size;
  if (activeByUser.size === 0) return summary;

  const todayKey = DAY_KEYS[new Date(nowMs).getDay()]!; // getDay() is always 0-6
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);

  // 3. Build the candidate reminders per active program.
  const candidates: Candidate[] = [];
  for (const { program, currentWeek } of activeByUser.values()) {
    const data = program.program_data as ProgramData;
    const programName = program.name ?? "your program";

    // Logs for the current + prior week are all the two triggers need.
    const { data: logRows } = await admin
      .from("workout_logs")
      .select("week_number, day, session_index, status, rpe, actuals, note")
      .eq("program_id", program.id)
      .in("week_number", [currentWeek - 1, currentWeek]);
    const logs: WorkoutLog[] = ((logRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      weekNumber: r.week_number as number,
      day: r.day as WorkoutLog["day"],
      sessionIndex: r.session_index as number,
      status: r.status as WorkoutLog["status"],
      rpe: (r.rpe as number | null) ?? null,
      actuals: (r.actuals as WorkoutLog["actuals"]) ?? null,
      note: (r.note as string | null) ?? null,
    }));

    // workout_due: unlogged sessions scheduled today.
    const week = data.weeks.find((w) => w.weekNumber === currentWeek);
    if (week) {
      const due = unloggedSessionsToday(week, todayKey, logs);
      if (due > 0) {
        summary.workoutDue += 1;
        candidates.push({
          userId: program.user_id,
          kind: "workout_due",
          dedupKey: `workout_due:${program.user_id}:${todayStr}`,
          title: "Today's training",
          body:
            due === 1
              ? `You have a session on today's plan for ${programName}. Tap to log it.`
              : `You have ${due} sessions on today's plan for ${programName}. Tap to log them.`,
          url: `/program/${program.id}`,
          tag: "duravel-workout-due",
        });
      }
    }

    // week_review: first day of a new week + the prior week had activity.
    if (todayKey === "mon" && currentWeek >= 2 && weekHasActivity(currentWeek - 1, logs)) {
      const priorWeek = currentWeek - 1;
      summary.weekReview += 1;
      candidates.push({
        userId: program.user_id,
        kind: "week_review",
        dedupKey: `week_review:${program.user_id}:${program.id}:${priorWeek}`,
        title: `Week ${priorWeek} review is ready`,
        body: "See how last week went and what's coming up this week.",
        url: `/program/${program.id}`,
        tag: "duravel-week-review",
      });
    }
  }

  // 4. Claim each send idempotently, then dispatch.
  for (const c of candidates) {
    // ON CONFLICT DO NOTHING: a returned row means we won the claim; empty means
    // it already fired (a prior/partial run) → skip.
    const { data: claimed } = await admin
      .from("push_sends")
      .upsert(
        { user_id: c.userId, dedup_key: c.dedupKey, kind: c.kind },
        { onConflict: "dedup_key", ignoreDuplicates: true },
      )
      .select("id");
    if (!claimed || claimed.length === 0) {
      summary.skippedDup += 1;
      continue;
    }

    const result = await sendPushToUser(c.userId, {
      title: c.title,
      body: c.body,
      url: c.url,
      tag: c.tag,
    });
    if (result.sent > 0) summary.sent += 1;
    else if (result.found === 0) summary.noSubscription += 1;
    else summary.failed += 1;
  }

  return summary;
}
