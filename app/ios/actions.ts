"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { IOS_WAITLIST_SOURCE } from "@/lib/ios-link";

export type WaitlistState = { status: "idle" | "ok" | "error"; message: string };

const Email = z.string().trim().toLowerCase().email().max(200);

/**
 * Join the iOS beta waitlist. Public and unauthenticated, like the science-PDF
 * capture, and stored in the same `science_leads` table with source `ios_beta`
 * so it shows up on /admin/leads. Writes are service-role only (no anon policy).
 * A repeat signup is accepted quietly rather than stored twice. `website` is a
 * honeypot: people never see it, form-filling bots do.
 */
export async function joinIosWaitlist(
  _prev: WaitlistState,
  form: FormData,
): Promise<WaitlistState> {
  if (String(form.get("website") ?? "") !== "")
    return { status: "ok", message: "You're on the list." };
  const parsed = Email.safeParse(form.get("email"));
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." };
  const email = parsed.data;
  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("science_leads")
      .select("id")
      .eq("email", email)
      .eq("source", IOS_WAITLIST_SOURCE)
      .limit(1);
    if (!existing || existing.length === 0) {
      const { error } = await admin
        .from("science_leads")
        .insert({ email, source: IOS_WAITLIST_SOURCE });
      if (error) {
        console.error("[ios] waitlist insert failed:", error.message);
        return { status: "error", message: "Couldn't save that just now — please try again." };
      }
    }
  } catch (err) {
    console.error("[ios] waitlist error:", err instanceof Error ? err.message : String(err));
    return { status: "error", message: "Couldn't save that just now — please try again." };
  }
  return {
    status: "ok",
    message: "You're on the list. We'll email you once when the iPhone beta opens.",
  };
}
