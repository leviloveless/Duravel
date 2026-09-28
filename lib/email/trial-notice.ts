/**
 * The carded-trial notices (2026-09-28) — PURE, so every rule is tested.
 *
 * Since 2026-09-20 the trial is a Stripe subscription in `trialing`: the card is
 * on file, nothing is charged for seven days, and Stripe bills automatically at
 * the end unless the athlete cancels. Two emails go with that:
 *
 *   started — when the trial begins. It replaces the $0.00 "receipt" Stripe's
 *             zero-amount first invoice used to trigger, which told a trialing
 *             athlete "your subscription is active" and never mentioned a charge.
 *   ending  — about three days before the charge. Sent from Stripe's
 *             `customer.subscription.trial_will_end` event, with the daily cron
 *             as a backstop in case that event is not enabled on the endpoint.
 *
 * Both state the plan, the amount, the date and how to cancel. Both are keyed to
 * the subscription AND its trial-end timestamp, so the webhook and the cron can
 * never both send one, and an admin moving the trial end (a new timestamp)
 * legitimately earns a fresh reminder.
 */

export type TrialNoticeKind = "started" | "ending";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Idempotency key shared by every sender of the same notice. */
export function trialNoticeKey(
  kind: TrialNoticeKind,
  subscriptionId: string,
  trialEndUnix: number,
): string {
  return `trial_notice:${kind}:${subscriptionId}:${trialEndUnix}`;
}

export type TrialState = {
  status: string;
  cancelAtPeriodEnd: boolean;
  /** When the trial ends and the card is charged. */
  trialEndMs: number | null;
};

/**
 * Whether a charge is still coming: trialing, not set to cancel, end in the
 * future. Checked as late as possible before sending — someone who cancels an
 * hour before the reminder goes out must not be told they are about to be
 * charged.
 */
export function chargeStillPending(s: TrialState, nowMs: number): boolean {
  return (
    s.status === "trialing" && !s.cancelAtPeriodEnd && s.trialEndMs !== null && s.trialEndMs > nowMs
  );
}

/**
 * The cron backstop's window for the "ending" notice: the charge is between
 * half a day and three and a half days away. Stripe's own event fires three days
 * out, inside this window, so whichever runs first sends and the other finds the
 * key taken. Under half a day is too late to be useful notice.
 */
export function endingNoticeDue(s: TrialState, nowMs: number): boolean {
  if (!chargeStillPending(s, nowMs) || s.trialEndMs === null) return false;
  const ahead = s.trialEndMs - nowMs;
  return ahead >= 0.5 * DAY_MS && ahead <= 3.5 * DAY_MS;
}

/** "Oct 5, 2026" in the athlete's zone when known, else UTC. */
export function formatChargeDate(unix: number, timeZone: string | null | undefined): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  try {
    return new Date(unix * 1000).toLocaleDateString("en-US", {
      ...opts,
      timeZone: timeZone || "UTC",
    });
  } catch {
    return new Date(unix * 1000).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  }
}

/** "$19.99" from minor units. */
export function formatCharge(amountMinor: number, currency: string): string {
  const value = amountMinor / 100;
  try {
    return value.toLocaleString("en-US", { style: "currency", currency: currency.toUpperCase() });
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

/** "Duravel Monthly" etc., matching the receipt's wording. */
export function planLabelFor(plan: string | null, tier: string | null): string {
  if (tier === "custom") return "Duravel Custom";
  if (plan === "annual") return "Duravel Annual";
  if (plan === "monthly") return "Duravel Monthly";
  return "Duravel";
}

/** "/month" or "/year" for the price line. */
export function perInterval(interval: string | null | undefined): string {
  if (interval === "year") return "/year";
  if (interval === "month") return "/month";
  return "";
}
