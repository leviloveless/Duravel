import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { sendEmail, type SendResult } from "../send";
import { isSubscriptionActive } from "../gate";
import { mintUnsubToken } from "../unsubscribe";
import type { OnboardingNudgeProps } from "../templates/types";
import { onboardingNudgeDue } from "./due";
import { TRIAL_DAYS } from "@/lib/billing-constants";

/**
 * Onboarding-nudge flow (07 §2.1 #2) — mirrors trial-ending. On each daily run it finds
 * users ~2 days into their still-active trial who have NOT generated a program yet, and
 * routes a suppressible `onboarding_nudge` through sendEmail (which applies the preference
 * + frequency gates and one-click List-Unsubscribe header itself). The in-body
 * unsubscribeUrl is minted here so the copy links a working one-click token.
 *
 * Idempotent on `onboarding_nudge:<userId>` (once-ever) + the pure due window, so a
 * re-run or resumed cron never double-sends. Service-role admin client (session-less).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OnboardingNudgeSummary {
  candidates: number;
  due: number;
  skippedActiveSub: number;
  skippedHasProgram: number;
  sent: number;
  skipped: number;
  failed: number;
}

interface DueUser {
  userId: string;
  firstName: string;
  daysLeft: number;
}

export async function runOnboardingNudgeFlow(
  admin: SupabaseClient,
  nowMs: number,
): Promise<OnboardingNudgeSummary> {
  const appUrl = env.NEXT_PUBLIC_SITE_URL ?? "https://duravel.app";
  const secret = env.EMAIL_UNSUB_SECRET;
  const summary: OnboardingNudgeSummary = {
    candidates: 0,
    due: 0,
    skippedActiveSub: 0,
    skippedHasProgram: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  // Candidate window: signed up ~2 days ago (±1-day cushion); precise day decided per-row.
  const startedFrom = new Date(nowMs - 4 * DAY_MS).toISOString();
  const startedTo = new Date(nowMs - 1 * DAY_MS).toISOString();

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

  const due: DueUser[] = [];
  for (const r of rows) {
    if (!r.trial_started_at) continue;
    const d = onboardingNudgeDue(r.trial_started_at, nowMs, TRIAL_DAYS);
    if (!d) continue;
    due.push({ userId: r.id, firstName: r.first_name ?? "there", daysLeft: d.daysLeft });
  }
  summary.due = due.length;
  if (due.length === 0) return summary;

  // Pre-filter active subscribers (sendEmail doesn't re-check this for the nudge, but an
  // active subscriber is past onboarding — no reason to nudge them).
  const activeIds = await loadActiveSubscriberIds(admin, due.map((d) => d.userId), nowMs);

  const generateUrl = `${appUrl}/onboarding`;
  const manageUrl = `${appUrl}/settings/email`;

  for (const d of due) {
    if (activeIds.has(d.userId)) {
      summary.skippedActiveSub += 1;
      continue;
    }
    if (await hasProgram(admin, d.userId)) {
      summary.skippedHasProgram += 1;
      continue;
    }

    const unsubscribeUrl = secret
      ? `${appUrl}/api/email/unsubscribe?token=${encodeURIComponent(
          mintUnsubToken({ userId: d.userId, category: "onboarding", issuedAt: nowMs }, secret),
        )}`
      : manageUrl;

    const props: OnboardingNudgeProps = {
      firstName: d.firstName,
      daysLeft: d.daysLeft,
      generateUrl,
      unsubscribeUrl,
      manageUrl,
    };

    const result = await sendEmail({
      userId: d.userId,
      template: "onboarding_nudge",
      dedup: { template: "onboarding_nudge", userId: d.userId },
      render: { template: "onboarding_nudge", props },
      meta: { flow: "onboarding_nudge" },
    });
    tally(summary, result);
  }

  return summary;
}

function tally(summary: OnboardingNudgeSummary, result: SendResult): void {
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
    if (isSubscriptionActive({ status: r.status, current_period_end: r.current_period_end }, nowMs)) {
      active.add(r.user_id);
    }
  }
  return active;
}

async function hasProgram(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { count } = await admin
    .from("programs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return (count ?? 0) > 0;
}
