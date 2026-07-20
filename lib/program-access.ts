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
