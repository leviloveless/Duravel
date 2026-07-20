/**
 * Fundraiser math + formatting (#19) — PURE, unit-testable. Amounts are stored in
 * cents; these helpers convert to display dollars and a clamped progress %.
 */

export interface Fundraiser {
  id: string;
  title: string;
  tagline: string | null;
  donate_url: string | null;
  goal_cents: number;
  raised_cents: number;
  updated_at: string;
}

/** Cents → whole/one-dp dollars number. */
export function centsToUsd(cents: number): number {
  return Math.round(cents) / 100;
}

/** Cents → "$1,234" (whole dollars, thousands-separated). */
export function formatUsd(cents: number): string {
  return `$${centsToUsd(cents).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

/** Raised as a 0–100 integer % of goal (0 when goal is unset). */
export function progressPct(raisedCents: number, goalCents: number): number {
  if (!(goalCents > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((raisedCents / goalCents) * 100)));
}

/** Remaining to goal, in cents (never negative). */
export function remainingCents(raisedCents: number, goalCents: number): number {
  return Math.max(0, goalCents - raisedCents);
}

/** Parse a user-typed dollar amount ("1,234.56" / "$1234") to integer cents, or null. */
export function dollarsToCents(text: string): number | null {
  const cleaned = (text ?? "").replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
