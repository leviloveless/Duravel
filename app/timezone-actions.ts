"use server";

import { createClient } from "@/lib/supabase/server";
import { isValidTimeZone } from "@/lib/timezone";

/**
 * Backfill `profiles.timezone` from the browser (migration 0039).
 *
 * Onboarding captures the zone for new athletes, but everyone who signed up
 * before 0039 has none — including every athlete whose Strava activities are
 * currently stamped in UTC. Asking them to re-onboard for it would be absurd, so
 * `<TimezoneSync>` reports the browser's zone on any authenticated page load and
 * this writes it if it CHANGED.
 *
 * Deliberately quiet: it returns nothing, never throws, and never surfaces a
 * failure. It is a background correction, not a user action — and it must not be
 * able to break a page that merely rendered while it ran.
 */
export async function syncTimezone(timezone: string): Promise<void> {
  try {
    // Validate before it reaches the DB: this is client-supplied and lands in an
    // unconstrained `text` column that Postgres later hands to `at time zone`.
    if (!isValidTimeZone(timezone)) return;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // RLS already scopes writes to the caller's own row; `.eq("id", user.id)` is
    // belt-and-braces. Read first so the common case (zone unchanged) costs one
    // cheap select and no write — this runs on every page load.
    const { data: prof, error } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();
    // A missing column means 0039 has not been applied yet. Do nothing.
    if (error || !prof || prof.timezone === timezone) return;

    await supabase.from("profiles").update({ timezone }).eq("id", user.id);
  } catch {
    /* best-effort: a failed backfill must never affect the page */
  }
}
