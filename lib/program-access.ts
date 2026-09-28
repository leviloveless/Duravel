import type { ProgramData } from "@/lib/schemas";

/**
 * Program access gating (#18) — PURE, unit-testable.
 *
 * Unsubscribed users (no live subscription AND no active free trial → not
 * entitled per `lib/subscription.getEntitlement`) may preview only the first
 * `FREE_PREVIEW_WEEKS` weeks of a program. Subscribers/trialers see everything.
 *
 * The gate truncates the `weeks` array so that when the caller passes the result
 * to the client, the locked weeks' session detail is NEVER serialized to the
 * browser — this is a real gate, not a CSS hide.
 */

export const FREE_PREVIEW_WEEKS = 2;

export interface GateResult {
  /** Program with only the visible weeks (unchanged when entitled). */
  program: ProgramData;
  /** How many weeks are hidden behind the paywall (0 when entitled). */
  lockedWeeks: number;
  /** True when the viewer is seeing a truncated preview. */
  previewing: boolean;
}

/**
 * Truncate a program to the free preview when the viewer isn't entitled.
 * `entitled` should come from `getEntitlement().entitled` (billing-off, live
 * subscription, or active trial all count as entitled).
 */
export function gateProgramWeeks(
  program: ProgramData,
  entitled: boolean,
  previewWeeks: number = FREE_PREVIEW_WEEKS,
): GateResult {
  if (entitled) return { program, lockedWeeks: 0, previewing: false };
  const visible = program.weeks.slice(0, Math.max(0, previewWeeks));
  return {
    program: { ...program, weeks: visible },
    lockedWeeks: Math.max(0, program.weeks.length - visible.length),
    previewing: true,
  };
}

/**
 * Whether a program may be GENERATED for someone who is not entitled
 * (2026-09-28).
 *
 * The card-on-file model works like this: an athlete builds a program for free,
 * sees the first `FREE_PREVIEW_WEEKS`, and is asked for a card — starting the
 * trial — to open the rest. That last step lives on a generated program's page.
 * But `/api/generate` refused everyone without a live subscription, so a new
 * athlete was turned away at generation and never saw the offer at all: no
 * program, no preview, no trial.
 *
 * So the FIRST program is free: allowed when this is a first build (not a
 * recalculate) and the athlete has no other program that ever reached `ready`.
 * Anything beyond that — a second program, or recalculating the free one — is
 * what the trial is for. The per-user generation rate limit still applies, so a
 * free program costs at most what any other one does.
 */
export function mayGenerateWithoutEntitlement(args: {
  /** An explicit recalculate of an existing program. */
  force: boolean;
  /** Programs this athlete owns, OTHER than this one, whose status is `ready`. */
  otherReadyPrograms: number;
}): boolean {
  return !args.force && args.otherReadyPrograms === 0;
}
