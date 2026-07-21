import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPushToUser, pushConfigured } from "@/lib/push/send";

/**
 * POST /api/push/test — send a test notification to the signed-in user's own
 * devices. Lets someone verify the full pipeline (SW registered → subscription
 * stored → server send → notification shown) end-to-end from Settings, with no
 * cron and no other user involved.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!pushConfigured()) {
      return NextResponse.json(
        { error: "Push is not configured on the server." },
        { status: 503 },
      );
    }

    const result = await sendPushToUser(user.id, {
      title: "Duravel",
      body: "Reminders are on — you'll get a nudge when a session is due. 💪",
      url: "/dashboard",
      tag: "duravel-test",
    });

    if (result.sent === 0) {
      // Distinguish the real reason so a zero-send is diagnosable rather than
      // always reading as "no subscriptions".
      let error = "No active subscriptions for this account.";
      let status = 409;
      if (result.skipped) {
        error = `Push unavailable on the server (${result.skipped}).`;
        status = 503;
      } else if (result.readError) {
        error = `Could not read subscriptions (${result.readError}).`;
        status = 500;
      } else if ((result.found ?? 0) > 0) {
        error = `Found ${result.found} subscription(s) but all sends failed — check VAPID keys.`;
        status = 502;
      }
      return NextResponse.json({ ok: false, error, ...result }, { status });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // Never let the handler return a non-JSON 500 — the client only shows the
    // JSON `error` field, so surface the real message.
    return NextResponse.json(
      { ok: false, error: `Server error: ${(e as Error)?.message ?? "unknown"}` },
      { status: 500 },
    );
  }
}
