import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { emailEnabled } from "@/lib/email/resend";
import { runTrialReminderFlow } from "@/lib/email/flows/trial-notice";
import { runOnboardingNudgeFlow } from "@/lib/email/flows/onboarding-nudge";
import { runPushRemindersFlow } from "@/lib/push/reminders";

/**
 * GET /api/cron/lifecycle  — the daily lifecycle-email job (07-spec §4.2).
 *
 * Secured by `Authorization: Bearer ${CRON_SECRET}` (Vercel injects this header for
 * configured crons; see vercel.json). Runs even when EMAIL_ENABLED is off — sendEmail()
 * then short-circuits each send to a 'skipped' ledger row, giving a full dry-run you can
 * inspect before flipping the flag.
 *
 * Order: reaper first (free wedged dedup keys), then trial-ending (time-critical), then
 * onboarding-nudge. Idempotent dedup keys make a re-run or a partial run safe.
 */
export const maxDuration = 60;

const STALE_QUEUED_MS = 30 * 60 * 1000;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!env.CRON_SECRET || authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowMs = Date.now();

  // Reaper: a row stuck in 'queued' past the cutoff means a crash between claim and
  // provider-ack. Flip it to 'failed' so it drops out of the partial index and the key
  // becomes reclaimable on a later run.
  const cutoff = new Date(nowMs - STALE_QUEUED_MS).toISOString();
  const { data: reapedRows } = await admin
    .from("email_sends")
    .update({
      status: "failed",
      error: "stale_queued_reaped",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "queued")
    .lt("created_at", cutoff)
    .select("id");
  const reaped = reapedRows?.length ?? 0;

  // Carded-trial "ends soon" notice, backstopping Stripe's trial_will_end event
  // (2026-09-28). Runs first: it is time-sensitive.
  const trialReminder = await runTrialReminderFlow(admin, nowMs);

  // Onboarding-nudge (suppressible; sendEmail applies preference + frequency gates).
  const onboardingNudge = await runOnboardingNudgeFlow(admin, nowMs);

  // Web-push workout reminders (opt-in via subscription; idempotent via push_sends).
  const pushReminders = await runPushRemindersFlow(admin, nowMs);

  return NextResponse.json({
    ok: true,
    emailEnabled: emailEnabled(),
    reaped,
    trialReminder,
    onboardingNudge,
    pushReminders,
  });
}
