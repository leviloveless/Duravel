import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { sendEmail, type SendResult } from "../send";
import { isSubscriptionActive } from "../gate";
import { trialStageDue } from "./due";

/**
 * Trial-ending flow (07-spec §2.1 #3). On each daily cron run it finds every user whose
 * 14-day trial ends in 3 / 1 / 0 days and has no active subscription, then routes a
 * T-3 / T-1 / T-0 send through sendEmail(). All the safety (flag, suppression, dedup,
 * late entitlement re-check) lives in sendEmail — this flow just detects who is due and
 * assembles the payload.
 *
 * Idempotency across runs is guaranteed by the per-stage dedup key + partial index, so a
 * cron that runs twice, or resumes after a crash, never double-sends.
 */
const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialEndingSummary {
  candidates: number;
  due: number;
  skippedActiveSub: number;
  sent: number;
  skipped: number;
  failed: number;
}

interface DueUser {
  userId: string;
  firstName: string;
  trialStartedAt: string;
  stage: "T-3" | "T-1" | "T-0";
}

/**
 * ⛔ DISABLED 2026-09-28 — returns an empty summary without sending anything.
 *
 * This flow finds its audience by `profiles.trial_started_at`, the start of the
 * OLD app-side 14-day no-card trial. Since 2026-09-20 the trial is carded and
 * lives in Stripe, but every signup still gets a `trial_started_at` — so this
 * was emailing athletes who never started a trial that "your free trial ends in
 * 3 days". And the athletes who DID start one (card on file, about to be
 * charged) get nothing, because the late entitlement re-check in `sendEmail`
 * skips anyone entitled, which a trialing subscriber is.
 *
 * The replacement is a reminder to TRIALING subscribers before their card is
 * charged, keyed off `subscriptions.current_period_end` — a different audience,
 * query and template, so it is its own change rather than a patch to this one.
 * Remove the early return only when the query below targets carded trials.
 */
const TRIAL_ENDING_DISABLED = true;

export async function runTrialEndingFlow(
  admin: SupabaseClient,
  nowMs: number,
): Promise<TrialEndingSummary> {
  if (TRIAL_ENDING_DISABLED) {
    return { candidates: 0, due: 0, skippedActiveSub: 0, sent: 0, skipped: 0, failed: 0 };
  }
  const appUrl = env.NEXT_PUBLIC_SITE_URL ?? "https://duravel.app";
  const summary: TrialEndingSummary = {
    candidates: 0,
    due: 0,
    skippedActiveSub: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  // Candidate window: trials whose start puts their end date within the T-3..T-0 range
  // (with a 1-day cushion on each side). Precise stage is decided per-row below.
  const startedFrom = new Date(nowMs - (TRIAL_DAYS + 1) * DAY_MS).toISOString();
  const startedTo = new Date(nowMs - (TRIAL_DAYS - 3 - 1) * DAY_MS).toISOString();

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, first_name, trial_started_at")
    .gte("trial_started_at", startedFrom)
    .lte("trial_started_at", startedTo);

  const rows = (profiles ?? []) as Array<{
    id: string;
    first_name: string | null;
    trial_started_at: string | null;
  }>;
  summary.candidates = rows.length;

  // Keep only rows that are actually due for a stage today.
  const due: DueUser[] = [];
  for (const r of rows) {
    if (!r.trial_started_at) continue;
    const stage = trialStageDue(r.trial_started_at, nowMs, TRIAL_DAYS);
    if (!stage) continue;
    due.push({
      userId: r.id,
      firstName: r.first_name ?? "there",
      trialStartedAt: r.trial_started_at,
      stage,
    });
  }
  summary.due = due.length;
  if (due.length === 0) return summary;

  // Pre-filter active subscribers (sendEmail re-checks this too, right before send — this
  // just avoids claiming a dedup key we'd immediately skip).
  const activeIds = await loadActiveSubscriberIds(
    admin,
    due.map((d) => d.userId),
    nowMs,
  );

  const subscribeUrl = `${appUrl}/pricing?plan=monthly`;
  const annualUrl = `${appUrl}/pricing?plan=annual`;
  const manageUrl = `${appUrl}/settings/email`;

  for (const d of due) {
    if (activeIds.has(d.userId)) {
      summary.skippedActiveSub += 1;
      continue;
    }
    const sessionsLogged = await countSessions(admin, d.userId);
    const programName = await latestProgramName(admin, d.userId);
    const props = {
      stage: d.stage,
      firstName: d.firstName,
      sessionsLogged,
      ...(programName ? { programName } : {}),
      subscribeUrl,
      annualUrl,
      manageUrl,
    };

    const result = await sendEmail({
      userId: d.userId,
      template: "trial_ending",
      dedup: {
        template: "trial_ending",
        userId: d.userId,
        stage: d.stage,
        trialStartedAt: d.trialStartedAt,
      },
      render: { template: "trial_ending", props },
      meta: { stage: d.stage, flow: "trial_ending" },
    });
    tally(summary, result);
  }

  return summary;
}

function tally(summary: TrialEndingSummary, result: SendResult): void {
  if (result.status === "sent") summary.sent += 1;
  else if (result.status === "skipped") summary.skipped += 1;
  else summary.failed += 1;
}

async function loadActiveSubscriberIds(
  admin: SupabaseClient,
  userIds: string[],
  nowMs: number,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { data } = await admin
    .from("subscriptions")
    .select("user_id, status, current_period_end")
    .in("user_id", userIds);
  const rows = (data ?? []) as Array<{
    user_id: string;
    status: string;
    current_period_end: string | null;
  }>;
  const active = new Set<string>();
  for (const r of rows) {
    if (
      isSubscriptionActive({ status: r.status, current_period_end: r.current_period_end }, nowMs)
    ) {
      active.add(r.user_id);
    }
  }
  return active;
}

async function countSessions(admin: SupabaseClient, userId: string): Promise<number> {
  const { count } = await admin
    .from("workout_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return count ?? 0;
}

async function latestProgramName(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin
    .from("programs")
    .select("program_name")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const name = (data as { program_name?: string | null } | null)?.program_name;
  return name ?? null;
}
