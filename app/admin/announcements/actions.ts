"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-access";
import { recordAdminAction } from "@/lib/admin-audit";
import { expiryFromDays, safeAnnouncementLink } from "@/lib/admin-account-rules";
import { ANNOUNCEMENT_TAG } from "@/lib/site-announcement";

/**
 * Publish and take down the site announcement. Service role; admin-gated first
 * in each action. `updateTag` expires the cached banner so the change shows on
 * the next page view instead of up to a minute later.
 */

function f(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

export async function publishAnnouncement(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let result: string;
  try {
    const message = f(form, "message");
    if (message.length < 1 || message.length > 280)
      throw new Error("Message must be 1–280 characters.");
    const tone = f(form, "tone") === "warning" ? "warning" : "info";
    const rawLink = f(form, "link_url");
    const link = safeAnnouncementLink(rawLink);
    if (rawLink && !link)
      throw new Error("Link must be a path on this site (/library) or an https:// address.");
    const daysRaw = f(form, "days");
    const endsAt = daysRaw === "" ? null : expiryFromDays(Number(daysRaw), Date.now());

    const admin = createAdminClient();
    // One active at a time: retire the current one first. The unique index in
    // migration 0049 enforces this even if two saves race.
    const { error: offError } = await admin
      .from("site_announcements")
      .update({ active: false })
      .eq("active", true);
    if (offError) throw new Error(offError.message);
    const { error } = await admin.from("site_announcements").insert({
      message,
      tone,
      link_url: link,
      link_label: link ? f(form, "link_label") || null : null,
      ends_at: endsAt,
      created_by: actor.id,
    });
    if (error) throw new Error(error.message);
    updateTag(ANNOUNCEMENT_TAG);
    await recordAdminAction(admin, actor, { id: null, email: null }, "announcement.publish", {
      message,
      tone,
      link,
      endsAt,
    });
    result = "ok=announcement_published";
  } catch (err) {
    result = `error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`;
  }
  redirect(`/admin/announcements?${result}`);
}

export async function endAnnouncement(): Promise<void> {
  const actor = await requireAdmin();
  let result: string;
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("site_announcements")
      .update({ active: false })
      .eq("active", true);
    if (error) throw new Error(error.message);
    updateTag(ANNOUNCEMENT_TAG);
    await recordAdminAction(admin, actor, { id: null, email: null }, "announcement.end");
    result = "ok=announcement_ended";
  } catch (err) {
    result = `error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`;
  }
  redirect(`/admin/announcements?${result}`);
}
