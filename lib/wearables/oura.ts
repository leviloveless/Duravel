import type { NormalizedActivity, NormalizedDaily } from "./types";

/**
 * Oura — PURE helpers (no env, no I/O), so they're unit-testable in isolation.
 * The network calls live in `oura-api.ts` and the DB writes in `oura-sync.ts`.
 *
 * Oura API v2 (2026): OAuth 2.0 authorization-code, multi-user. Refresh tokens
 * are single-use / rotating — every refresh returns a NEW refresh token that must
 * be persisted (handled in oura-sync). Data base is the v2 usercollection API.
 */

export const OURA_AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
export const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
export const OURA_API_BASE = "https://api.ouraring.com/v2/usercollection";

/**
 * Scopes we request (space-delimited per OAuth 2). `daily` unlocks the sleep /
 * daily_sleep / readiness collections (where raw HRV + resting-HR live); `workout`
 * the workout collection; `personal` basic profile. Insufficient scope makes Oura
 * return EMPTY ARRAYS rather than errors, so we request exactly what we read.
 */
export const OURA_SCOPE = "daily workout personal";

/** Build the Oura authorize URL the user is redirected to. */
export function ouraAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: OURA_SCOPE,
    state,
  });
  return `${OURA_AUTHORIZE_URL}?${p.toString()}`;
}

/** True if the token is absent or expires within the next 60 seconds. */
export function isTokenExpired(expiresAt: string | null, now: number = Date.now()): boolean {
  if (!expiresAt) return true;
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) return true;
  return ms - 60_000 <= now;
}

export type OuraTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds from now
  token_type?: string;
  scope?: string;
};

/** Oura returns `expires_in` seconds-from-now → absolute ISO expiry. */
export function expiresAtFromNow(expiresInSeconds: number, now: number = Date.now()): string {
  const secs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600;
  return new Date(now + secs * 1000).toISOString();
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/** Seconds between two ISO datetimes, or null if either is unparseable. */
export function durationSeconds(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 1000);
}

/**
 * Normalize a raw Oura workout into our provider-agnostic activity shape.
 * Oura workouts carry no heart-rate summary, so avg/max HR stay null.
 */
export function normalizeOuraWorkout(w: Record<string, unknown>): NormalizedActivity {
  const start = str(w.start_datetime);
  const end = str(w.end_datetime);
  return {
    externalId: w.id != null ? String(w.id) : "",
    type: str(w.activity),
    startTime: start,
    durationS: durationSeconds(start, end),
    distanceM: num(w.distance),
    avgHr: null,
    maxHr: null,
    raw: w,
  };
}

// --- Daily recovery: raw HRV + resting-HR live in the DETAILED sleep endpoint,
//     the sleep SCORE lives in daily_sleep. We merge both by calendar `day`. ---

export type OuraSleepRecord = Record<string, unknown>;
export type OuraDailySleepRecord = Record<string, unknown>;

/**
 * Oura can return several sleep periods for one day (naps + main sleep). Pick the
 * one with the greatest `total_sleep_duration` as the night's canonical record.
 */
export function pickMainSleep(records: OuraSleepRecord[]): OuraSleepRecord | null {
  let best: OuraSleepRecord | null = null;
  let bestDur = -1;
  for (const r of records) {
    const dur = num(r.total_sleep_duration) ?? 0;
    if (dur > bestDur) {
      bestDur = dur;
      best = r;
    }
  }
  return best;
}

/**
 * Merge detailed sleep (HRV, resting-HR proxy) with daily_sleep (score) into one
 * canonical daily row per date. `lowest_heart_rate` from the night is Oura's best
 * resting-HR proxy; `average_hrv` is the overnight HRV in ms.
 */
export function buildOuraDailies(
  sleepRecords: OuraSleepRecord[],
  dailySleepRecords: OuraDailySleepRecord[],
): NormalizedDaily[] {
  // Group detailed sleep by day, keep the main sleep per day.
  const byDay = new Map<string, OuraSleepRecord[]>();
  for (const r of sleepRecords) {
    const day = str(r.day);
    if (!day) continue;
    const list = byDay.get(day) ?? [];
    list.push(r);
    byDay.set(day, list);
  }

  const scoreByDay = new Map<string, number>();
  for (const d of dailySleepRecords) {
    const day = str(d.day);
    const score = num(d.score);
    if (day && score != null) scoreByDay.set(day, score);
  }

  const days = new Set<string>([...byDay.keys(), ...scoreByDay.keys()]);
  const out: NormalizedDaily[] = [];
  for (const day of days) {
    const main = pickMainSleep(byDay.get(day) ?? []);
    const restingHr = main ? num(main.lowest_heart_rate) : null;
    const hrv = main ? num(main.average_hrv) : null;
    const sleepScore = scoreByDay.get(day) ?? null;
    // Skip a day that carries no usable signal at all.
    if (restingHr == null && hrv == null && sleepScore == null) continue;
    out.push({ date: day, restingHr, hrv, sleepScore, raw: { sleep: main, sleepScore } });
  }
  // Stable, newest-first.
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD in UTC for a timestamp. */
export function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Date window (YYYY-MM-DD) for Oura's `start_date`/`end_date` params. From the
 * last sync we back up one day of overlap (Oura rescoring makes records mutable);
 * with no prior sync we look back `fallbackDays`. `end_date` is tomorrow so the
 * current day is always included regardless of Oura's inclusivity.
 */
export function ouraDateWindow(
  lastSyncIso: string | null,
  fallbackDays = 30,
  now: number = Date.now(),
): { startDate: string; endDate: string } {
  let startMs = now - fallbackDays * DAY_MS;
  if (lastSyncIso) {
    const ms = new Date(lastSyncIso).getTime();
    if (Number.isFinite(ms)) startMs = ms - DAY_MS;
  }
  return { startDate: ymd(startMs), endDate: ymd(now + DAY_MS) };
}
