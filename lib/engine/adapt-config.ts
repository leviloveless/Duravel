/**
 * Adaptation rule constants (Phase 2 — phase2-spec.md §4).
 *
 * Every tunable threshold in the adaptation engine lives here so coaching
 * philosophy changes are a one-file edit, mirroring how the questionnaire
 * drives the prompt layer. Values are the v2.0 rule set from the spec.
 */

export const ADAPT = {
  /** Below this compliance for 2+ consecutive weeks → re-anchor. */
  COMPLIANCE_REANCHOR: 0.4,
  /** Below this compliance → hold next week's volume (no progression). */
  COMPLIANCE_HOLD: 0.6,
  /** At/above this compliance (with low strain) → earned bump. */
  COMPLIANCE_BUMP: 0.9,

  /** Weighted-average RPE at/above this → early deload. */
  STRAIN_DELOAD: 8.0,
  /** …or at/above this for two consecutive weeks. */
  STRAIN_DELOAD_TREND: 7.5,
  /** Weighted-average RPE at/below this qualifies for the earned bump. */
  STRAIN_BUMP: 4.0,
  /** High RPE on easy work is the strongest overreach signal → weight it up. */
  EASY_RPE_WEIGHT: 1.5,

  /** Extra mileage on a scheduled increase week (+2.5% on top of +7.5%). */
  BUMP_EXTRA_MILEAGE_PCT: 0.025,

  /** Non-deload adjustments never move a week beyond ±20% of its original targets. */
  MAX_DEVIATION_PCT: 0.2,

  /** Early deload uses the engine's standard deload math (−40%). */
  DELOAD_FACTOR: 0.6,

  /** Re-anchor: −10% per missed week off the reviewed week's level… */
  REANCHOR_DECAY_PER_WEEK: 0.9,
  /** …with a floor at 60% of that level. */
  REANCHOR_FLOOR: 0.6,

  /** Partial sessions count as half a completed session for compliance. */
  PARTIAL_CREDIT: 0.5,

  /** Weekly compliance at/above this keeps the adherence streak alive. */
  STREAK_COMPLIANCE: 0.8,

  /** Fallback duration for a completed hybrid session with no logged actuals. */
  DEFAULT_HYBRID_MINUTES: 45,
} as const;
