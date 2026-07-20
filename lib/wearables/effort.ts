import type { WearableProvider } from "./types";

/**
 * Perceived-effort import (#12) — PURE, unit-testable.
 *
 * Athletes already log an RPE and a "how it felt" note in their tracking app.
 * When a synced activity is linked to a planned session we can lift those across
 * automatically instead of asking the athlete to retype them. Today only Strava
 * exposes them (via the activity DETAIL endpoint: `perceived_exertion` +
 * `private_note`); Oura/Apple Health workouts carry no RPE, and Garmin/Runna are
 * parked. The generic dispatcher returns nulls for those so the caller degrades
 * cleanly — and new sources slot in here without touching the link flow.
 */

/** Max stored note length (matches workout_logs.note / the log schema). */
export const FEEL_MAX = 280;

export interface Effort {
  /** Session RPE 1–10, or null if the source didn't carry one. */
  rpe: number | null;
  /** Short "how it felt" note, or null. */
  feel: string | null;
}

/** Strava `perceived_exertion` (athlete's 1–10 RPE) → our integer RPE, or null. */
export function rpeFromStravaExertion(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const r = Math.round(value);
  if (r < 1) return null; // 0 / unset → no RPE
  return Math.min(10, r);
}

/** A free-text note → trimmed, length-capped feel string, or null. */
export function feelFromNote(note: unknown, max = FEEL_MAX): string | null {
  if (typeof note !== "string") return null;
  const t = note.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/** Strava activity DETAIL → Effort. */
export function stravaEffortFromDetail(detail: {
  perceived_exertion?: unknown;
  private_note?: unknown;
}): Effort {
  return {
    rpe: rpeFromStravaExertion(detail.perceived_exertion),
    feel: feelFromNote(detail.private_note),
  };
}

/**
 * Generic dispatcher: pull the athlete's RPE/feel for a synced activity by
 * provider. `detail` is the provider's detail payload (Strava) or the stored raw
 * (others). Returns empty effort for providers that don't carry RPE today.
 */
export function effortFromActivity(provider: WearableProvider, detail: unknown): Effort {
  if (provider === "strava") {
    return stravaEffortFromDetail((detail ?? {}) as Record<string, unknown>);
  }
  // Oura / Apple Health carry no RPE; Garmin (paused) / Runna (no API) — later.
  return { rpe: null, feel: null };
}
