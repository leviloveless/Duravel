import type { TrialEndingStage } from "./templates/types";

/**
 * Dedup-key builders. The returned string is the app-level idempotency key that the
 * partial-unique index on email_sends enforces (migration 0022) and that is also sent
 * to Resend as the Idempotency-Key header.
 */
export type DedupInput =
  | { template: "welcome"; userId: string }
  | { template: "onboarding_nudge"; userId: string }
  | { template: "trial_ending"; userId: string; stage: TrialEndingStage; trialStartedAt: string }
  | { template: "receipt"; invoiceId: string };

/**
 * Trial-cycle discriminator (07-spec §2.1): epoch-seconds of trial_started_at. If the
 * trial start is reset (re-trial / support action), this string changes so a fresh
 * T-3/T-1/T-0 sequence is allowed rather than being suppressed by the old cycle's rows.
 */
export function trialCycle(trialStartedAt: string): string {
  const ms = new Date(trialStartedAt).getTime();
  return Number.isNaN(ms) ? `raw:${trialStartedAt}` : String(Math.floor(ms / 1000));
}

/** Stable idempotency key for a send. */
export function buildDedupKey(input: DedupInput): string {
  switch (input.template) {
    case "welcome":
      return `welcome:${input.userId}`;
    case "onboarding_nudge":
      return `onboarding_nudge:${input.userId}`;
    case "trial_ending":
      return `trial_ending:${input.stage}:${input.userId}:${trialCycle(input.trialStartedAt)}`;
    case "receipt":
      return `receipt:${input.invoiceId}`;
  }
}
