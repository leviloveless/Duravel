import type { TrialEndingStage } from "./templates/types";

/**
 * Shared types for the lifecycle email system (07-spec). Pure — no runtime imports,
 * safe to use from unit-tested modules.
 */

/** Every template the system can send this phase. */
export type EmailTemplate = "welcome" | "onboarding_nudge" | "trial_ending" | "receipt";

/** Consent tier. service = transactional (non-suppressible); lifecycle = suppressible. */
export type Tier = "service" | "lifecycle";

/** Per-category preference flags on email_preferences (suppressible categories only). */
export type PrefCategory =
  | "onboarding"
  | "weekly_summary"
  | "race"
  | "milestone"
  | "winback"
  | "engagement"
  | "product";

/** email_sends.status ledger values (must match the 0022 CHECK constraint). */
export type EmailStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "failed"
  | "skipped";

export type { TrialEndingStage };

/** Why a gate decided to skip a send. */
export type GateSkipReason =
  | "disabled"
  | "no_recipient"
  | "suppressed"
  | "unsubscribed_all"
  | "category_off"
  | "frequency_cap"
  | "now_subscribed";

/** Result of a gate evaluation. */
export type GateDecision = { proceed: true } | { proceed: false; reason: GateSkipReason };
