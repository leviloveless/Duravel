import type { EmailTemplate, GateDecision } from "./types";
import { templateMeta } from "./categories";

/**
 * The ordered send gate (07-spec §4.1), split into a pre-claim and a post-claim pass,
 * both PURE so the whole decision surface is unit-testable without touching Supabase,
 * Resend, or the network. The orchestrator (send.ts) fetches the inputs and calls these.
 */

/** True when an ISO instant falls on the same UTC calendar day as nowMs. */
export function isSameUtcDay(iso: string, nowMs: number): boolean {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  const a = new Date(then);
  const b = new Date(nowMs);
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export interface PreClaimInput {
  template: EmailTemplate;
  emailEnabled: boolean;
  /** Resolved recipient address, or null if none could be found. */
  recipient: string | null;
  /** Address is on the hard suppression list (bounce/complaint/manual). */
  suppressed: boolean;
  prefs: {
    unsubscribedAll: boolean;
    /** The per-category flag for this template; irrelevant for service tier. */
    categoryEnabled: boolean;
  };
  /** profiles.last_lifecycle_email_at, or null. */
  lastLifecycleEmailAt: string | null;
  nowMs: number;
}

/**
 * Steps 1–5, in exact order: feature flag → recipient resolvable → hard suppression →
 * (lifecycle only) global unsubscribe → category flag → ≤1 lifecycle/day frequency cap.
 * Service-tier templates skip the preference + frequency gates but still honor the
 * flag, a resolvable recipient, and the hard suppression list.
 */
export function evaluatePreClaim(input: PreClaimInput): GateDecision {
  if (!input.emailEnabled) return { proceed: false, reason: "disabled" };
  if (!input.recipient) return { proceed: false, reason: "no_recipient" };
  if (input.suppressed) return { proceed: false, reason: "suppressed" };

  if (templateMeta(input.template).tier === "lifecycle") {
    if (input.prefs.unsubscribedAll) return { proceed: false, reason: "unsubscribed_all" };
    if (!input.prefs.categoryEnabled) return { proceed: false, reason: "category_off" };
    if (input.lastLifecycleEmailAt && isSameUtcDay(input.lastLifecycleEmailAt, input.nowMs)) {
      return { proceed: false, reason: "frequency_cap" };
    }
  }
  return { proceed: true };
}

export interface PostClaimInput {
  template: EmailTemplate;
  subscriptionActive: boolean;
}

/**
 * Step 7: late entitlement re-check, run AFTER the idempotency claim and immediately
 * before send. Trial-ending must never fire for a now-active subscriber (spec §9 R1) —
 * e.g. someone who subscribes the same morning the cron runs.
 */
export function evaluatePostClaim(input: PostClaimInput): GateDecision {
  if (input.template === "trial_ending" && input.subscriptionActive) {
    return { proceed: false, reason: "now_subscribed" };
  }
  return { proceed: true };
}

/** Whether a subscriptions row is a live entitlement (mirrors lib/subscription.ts). */
export function isSubscriptionActive(
  row: { status: string; current_period_end: string | null } | null,
  nowMs: number,
): boolean {
  if (!row) return false;
  if (row.status !== "active" && row.status !== "trialing") return false;
  if (row.current_period_end && new Date(row.current_period_end).getTime() < nowMs) return false;
  return true;
}
