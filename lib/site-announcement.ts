import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * The one active site announcement, if any (table `site_announcements`,
 * migration 0049).
 *
 * Read with the ANON key and no cookies, and cached for 60 seconds under the
 * `site-announcement` tag. Every signed-in page shows it, so reading it per
 * request under each athlete's session would add a query to every page view for
 * a value that changes a few times a month. The admin actions expire the tag, so
 * a new or ended announcement shows up at once rather than after the minute.
 *
 * Any failure — the table not migrated yet, a network blip — reads as "no
 * announcement". A banner is never worth breaking the page for.
 */

export type SiteAnnouncement = {
  id: number;
  message: string;
  tone: "info" | "warning";
  link_url: string | null;
  link_label: string | null;
};

export const ANNOUNCEMENT_TAG = "site-announcement";

async function fetchActive(): Promise<SiteAnnouncement | null> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase
      .from("site_announcements")
      .select("id, message, tone, link_url, link_label")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return null;
    return ((data as SiteAnnouncement[] | null) ?? [])[0] ?? null;
  } catch {
    return null;
  }
}

export const getActiveAnnouncement = unstable_cache(fetchActive, ["site-announcement-v1"], {
  revalidate: 60,
  tags: [ANNOUNCEMENT_TAG],
});
