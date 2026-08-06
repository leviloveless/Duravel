"use client";

import { useEffect } from "react";
import { syncTimezone } from "@/app/timezone-actions";

/**
 * Reports the browser's IANA zone once per page load so `profiles.timezone`
 * stays current (migration 0039).
 *
 * Renders nothing. Mounted in the root layout because the zone matters on paths
 * the athlete may never revisit onboarding from — logging a workout auto-posts to
 * Strava with a local timestamp, and the adapt rate limit resets at local
 * midnight. The server action no-ops for signed-out visitors and when the zone
 * is unchanged, so the marketing pages pay one cheap call and nothing else.
 *
 * Also handles the athlete who MOVES: a traveller who trains in a new zone gets
 * their activities stamped correctly from their next page load, without touching
 * a settings screen.
 */
export default function TimezoneSync() {
  useEffect(() => {
    let tz = "";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    } catch {
      return; // no Intl zone available — the server falls back to UTC
    }
    if (!tz) return;
    void syncTimezone(tz);
  }, []);

  return null;
}
