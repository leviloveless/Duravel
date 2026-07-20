/**
 * HYROX Result API — PURE parsing/formatting helpers (#17), unit-testable.
 *
 * Source: hyroxresultapi.com (official API, Bearer auth, base
 * `https://hyroxresultapi.com/api/v1`). HYROX ONLY.
 *
 * The `/athletes/search` response ALREADY carries the finish time + name + event
 * for each hit (under `data`), so a search alone yields usable results — no
 * per-hit follow-up call. The `/athletes/{id}/splits` endpoint adds the segment
 * breakdown: a `data` array where each row is one segment
 * (`{canonical_key, label_original, order_index, time_ms, place}`) — the 8 running
 * legs, the 8 workout stations, the roxzone transition, and a couple of aggregate
 * rows (run total, best lap).
 */

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

function pickNum(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = num(o[k]);
    if (v != null) return v;
  }
  return null;
}
function pickStr(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = str(o[k]);
    if (v != null) return v;
  }
  return null;
}

/** Milliseconds → "h:mm:ss" (or "m:ss" under an hour). Null-safe → "". */
export function formatMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * One segment of a HYROX race from the `/athletes/{id}/splits` response.
 * `kind` groups them for display: the 8 running legs (`run`), the 8 workout
 * stations (`station`), the `roxzone` transition total, and aggregate `summary`
 * rows (run total, best run lap) that aren't a race segment of their own.
 */
export interface HyroxSplit {
  /** Canonical key from the API, e.g. "run1_time", "skiErg_time". */
  key: string;
  /** Human label from the API, e.g. "Running 1", "1000m SkiErg". */
  label: string;
  timeMs: number;
  /** Formatted, e.g. "6:40". */
  time: string;
  /** The API's race-order index (used to sort). */
  order: number;
  /** Field placing for this segment, when the API provides one. */
  place: number | null;
  kind: "run" | "station" | "roxzone" | "summary";
}

export interface HyroxResult {
  id: string;
  name: string | null;
  division: string | null;
  event: string | null;
  season: string | null;
  /** Total finish time in ms. */
  totalTimeMs: number | null;
  /** Formatted finish, e.g. "1:25:44". */
  finishTime: string;
  splits: HyroxSplit[];
}

/** Pull the hit array out of the response envelope (`{data:[…]}`, `{results:[…]}`,
 *  `{athletes:[…]}`, or a bare array). */
function pickArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  for (const key of ["data", "results", "athletes"] as const) {
    const v = (json as Record<string, unknown> | null)?.[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/** Parse a season number out of an event slug like "season-8-hd-…". */
function seasonFromSlug(slug: string | null): string | null {
  if (!slug) return null;
  const m = /season-(\d+)/i.exec(slug);
  return m ? `Season ${m[1]}` : null;
}

/**
 * Normalize the /athletes/search response into results. Each hit already has the
 * finish time, name, and event, so this is all the lookup needs.
 */
export function normalizeSearchResults(json: unknown): HyroxResult[] {
  const out: HyroxResult[] = [];
  for (const raw of pickArray(json)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const id = pickStr(o, ["id", "race_id", "raceId"]);
    if (!id) continue;
    const totalTimeMs = pickNum(o, ["total_time_ms", "totalTimeMs", "finish_time_ms", "total_time"]);
    out.push({
      id,
      name: pickStr(o, ["display_name", "name", "full_name", "fullName"]),
      division: pickStr(o, ["division", "division_key", "divisionKey", "age_group"]),
      event: pickStr(o, ["event_name", "eventName", "event", "race"]),
      season:
        pickStr(o, ["season", "season_name"]) ??
        seasonFromSlug(pickStr(o, ["event_slug", "eventSlug"])),
      totalTimeMs,
      finishTime: formatMs(totalTimeMs),
      splits: [],
    });
  }
  return out;
}

/** Group a split by its canonical key: 8 running legs, 8 stations, the roxzone
 *  transition, and the aggregate rows the API appends (run total, best lap). */
function classifySplit(key: string): HyroxSplit["kind"] {
  const k = key.toLowerCase();
  if (/^run\d+_time$/.test(k)) return "run";
  if (k === "run_time" || k === "best_run_lap_time") return "summary";
  if (k === "roxzone_time") return "roxzone";
  return "station";
}

/** Fallback label when the API omits `label_original`: "sledPush_time" → "Sled Push". */
function prettifyKey(key: string): string {
  return key
    .replace(/_time$/i, "")
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Normalize the `/athletes/{id}/splits` response into ordered segments. The
 * response is a `data` array of `{canonical_key, label_original, time_ms,
 * order_index, place}` rows; anything without a key or a numeric time is skipped.
 */
export function normalizeSplits(json: unknown): HyroxSplit[] {
  const out: HyroxSplit[] = [];
  for (const raw of pickArray(json)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const key = pickStr(o, ["canonical_key", "canonicalKey", "key"]);
    const timeMs = pickNum(o, ["time_ms", "timeMs"]);
    if (!key || timeMs == null) continue;
    out.push({
      key,
      label: pickStr(o, ["label_original", "label", "name"]) ?? prettifyKey(key),
      timeMs,
      time: formatMs(timeMs),
      order: pickNum(o, ["order_index", "orderIndex", "order"]) ?? out.length,
      place: pickNum(o, ["place", "rank"]),
      kind: classifySplit(key),
    });
  }
  out.sort((a, b) => a.order - b.order);
  return out;
}

/** Normalize an `/athletes/{id}/splits` response into a HyroxResult. The splits
 *  endpoint returns only segment rows (no name/finish total), so those stay null
 *  here — the caller merges these splits onto the search hit it already has. */
export function normalizeResult(id: string, json: unknown): HyroxResult {
  const o = (json && typeof json === "object" && !Array.isArray(json)
    ? json
    : {}) as Record<string, unknown>;
  const totalTimeMs = pickNum(o, ["total_time_ms", "totalTimeMs", "finish_time_ms", "total_time"]);
  return {
    id,
    name: pickStr(o, ["display_name", "name", "full_name", "fullName"]),
    division: pickStr(o, ["division", "division_key", "divisionKey"]),
    event: pickStr(o, ["event_name", "eventName", "event", "race"]),
    season: pickStr(o, ["season", "season_name"]),
    totalTimeMs,
    finishTime: formatMs(totalTimeMs),
    splits: normalizeSplits(json),
  };
}
