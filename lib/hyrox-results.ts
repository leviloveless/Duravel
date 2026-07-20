/**
 * HYROX Result API — PURE parsing/formatting helpers (#17), unit-testable.
 *
 * Source: hyroxresultapi.com (official API, Bearer auth, base
 * `https://hyroxresultapi.com/api/v1`). HYROX ONLY.
 *
 * The `/athletes/search` response ALREADY carries the finish time + name + event
 * for each hit (under `data`), so a search alone yields usable results — no
 * per-hit follow-up call. The `/athletes/{id}/splits` endpoint is only needed for
 * station-by-station splits (a later enhancement).
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
  splits: { station: string; timeMs: number; time: string }[];
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

/** Human labels for the known HYROX station split keys (best-effort). */
const STATION_LABELS: Record<string, string> = {
  skiErg: "SkiErg",
  ski: "SkiErg",
  sledPush: "Sled Push",
  sled_push: "Sled Push",
  sledPull: "Sled Pull",
  sled_pull: "Sled Pull",
  burpeeBroadJump: "Burpee Broad Jump",
  burpee: "Burpee Broad Jump",
  row: "Row",
  rowErg: "Row",
  farmersCarry: "Farmers Carry",
  farmers: "Farmers Carry",
  sandbagLunge: "Sandbag Lunge",
  lunge: "Sandbag Lunge",
  wallBalls: "Wall Balls",
  wallball: "Wall Balls",
};

/** Extract station splits from a result object's `splits` (or top-level *_time_ms keys). */
function extractSplits(o: Record<string, unknown>): HyroxResult["splits"] {
  const source =
    o.splits && typeof o.splits === "object" ? (o.splits as Record<string, unknown>) : o;
  const out: HyroxResult["splits"] = [];
  for (const [key, val] of Object.entries(source)) {
    const m = /^(.*?)_?time_ms$/i.exec(key);
    if (!m) continue;
    const ms = num(val);
    if (ms == null) continue;
    const base = m[1] ?? key;
    out.push({ station: STATION_LABELS[base] ?? base, timeMs: ms, time: formatMs(ms) });
  }
  return out;
}

/** Normalize an /athletes/{id}/splits response into a HyroxResult (for the later
 *  station-splits enhancement). */
export function normalizeResult(id: string, json: unknown): HyroxResult {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const totalTimeMs = pickNum(o, ["total_time_ms", "totalTimeMs", "finish_time_ms", "total_time"]);
  return {
    id,
    name: pickStr(o, ["display_name", "name", "full_name", "fullName"]),
    division: pickStr(o, ["division", "division_key", "divisionKey"]),
    event: pickStr(o, ["event_name", "eventName", "event", "race"]),
    season: pickStr(o, ["season", "season_name"]),
    totalTimeMs,
    finishTime: formatMs(totalTimeMs),
    splits: extractSplits(o),
  };
}
