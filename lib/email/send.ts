import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { EMAIL_FROM, EMAIL_REPLY_TO, emailEnabled, resend } from "./resend";
import { resolveRecipient } from "./recipient";
import { renderEmail, type RenderJob } from "./render";
import { templateMeta } from "./categories";
import { buildDedupKey, type DedupInput } from "./dedup";
import { evaluatePostClaim, evaluatePreClaim, isSubscriptionActive } from "./gate";
import { mintUnsubToken } from "./unsubscribe";
import type { EmailTemplate, EmailStatus, GateSkipReason, PrefCategory } from "./types";

/**
 * The single choke point every email routes through (07-spec §4.1). Enforces, in order:
 *   flag → recipient → suppression → preference → frequency-cap → idempotency claim
 *   → late entitlement re-check → render → send → advance ledger.
 * The ordered decisions live in ./gate (pure, unit-tested); this file is the thin I/O
 * layer that fetches inputs, claims the dedup key, and talks to Resend + the ledger.
 *
 * Writes go through the service-role admin client (RLS-bypassing) — email_sends,
 * email_suppressions, email_preferences and profiles.last_lifecycle_email_at have no
 * auth-role write policy, so a stray anon write would fail silently.
 */
export interface SendJob {
  userId: string;
  template: EmailTemplate;
  /** Identity for the idempotency key. */
  dedup: DedupInput;
  /** Payload for rendering (typed per template). */
  render: RenderJob;
  scheduledFor?: string | null;
  meta?: Record<string, unknown>;
}

export type SendResult =
  | { status: "sent" }
  | { status: "skipped"; reason: GateSkipReason | "duplicate" }
  | { status: "failed"; reason: string };

const APP_URL = env.NEXT_PUBLIC_SITE_URL ?? "https://duravel.app";

export async function sendEmail(job: SendJob): Promise<SendResult> {
  const admin = createAdminClient();
  const meta = templateMeta(job.template);
  const dedupKey = buildDedupKey(job.dedup);
  const nowMs = Date.now();
  const on = emailEnabled();

  // Steps 1–3: flag, recipient, suppression.
  const recipient = on ? await resolveRecipient(admin, job.userId) : null;
  const suppressed = recipient ? await isSuppressed(admin, recipient) : false;

  // Steps 4–5 (lifecycle only): preference + frequency cap inputs.
  const prefs =
    meta.tier === "lifecycle"
      ? await loadPrefs(admin, job.userId, meta.prefCategory)
      : { unsubscribedAll: false, categoryEnabled: true };
  const lastLifecycleEmailAt =
    meta.tier === "lifecycle" ? await loadLastLifecycle(admin, job.userId) : null;

  const pre = evaluatePreClaim({
    template: job.template,
    emailEnabled: on,
    recipient,
    suppressed,
    prefs,
    lastLifecycleEmailAt,
    nowMs,
  });
  if (!pre.proceed) {
    // Dry-run / gated: record a 'skipped' row for visibility. Safe — the partial index
    // excludes 'skipped', so it never blocks the real send later.
    await writeLedger(admin, job, dedupKey, "skipped", { error: pre.reason });
    return { status: "skipped", reason: pre.reason };
  }

  // Step 6: idempotency claim. A duplicate LIVE key raises 23505 on the partial index.
  const claim = await claimSend(admin, job, dedupKey);
  if (!claim.claimed) return { status: "skipped", reason: "duplicate" };

  // Step 7: late entitlement re-check (trial-ending only), as close to send as possible.
  if (job.template === "trial_ending") {
    const active = isSubscriptionActive(await loadSubscription(admin, job.userId), nowMs);
    const post = evaluatePostClaim({ template: job.template, subscriptionActive: active });
    if (!post.proceed) {
      await markStatus(admin, claim.id, "skipped", { error: post.reason });
      return { status: "skipped", reason: post.reason };
    }
  }

  if (!recipient || !resend) {
    await markStatus(admin, claim.id, "failed", { error: "no_client_or_recipient" });
    return { status: "failed", reason: "no_client_or_recipient" };
  }

  // Steps 8–10: render, send, advance the ledger.
  try {
    const { subject, html, text } = await renderEmail(job.render);
    const res = await resend.emails.send(
      {
        from: EMAIL_FROM,
        to: recipient,
        replyTo: EMAIL_REPLY_TO,
        subject,
        html,
        text,
        headers: listUnsubscribeHeaders(job.template, job.userId, meta.prefCategory, nowMs),
      },
      { idempotencyKey: dedupKey },
    );
    if (res.error) throw new Error(res.error.message);

    await markStatus(admin, claim.id, "sent", {
      resend_id: res.data?.id ?? null,
      sent_at: new Date(nowMs).toISOString(),
    });
    if (meta.tier === "lifecycle") await stampLifecycle(admin, job.userId, nowMs);
    return { status: "sent" };
  } catch (err) {
    await markStatus(admin, claim.id, "failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "failed", reason: "send_error" };
  }
}

// --- RFC 8058 one-click unsubscribe (lifecycle only; service mail is non-suppressible) ---

function listUnsubscribeHeaders(
  template: EmailTemplate,
  userId: string,
  prefCategory: PrefCategory | null,
  nowMs: number,
): Record<string, string> | undefined {
  if (templateMeta(template).tier !== "lifecycle") return undefined;
  const secret = env.EMAIL_UNSUB_SECRET;
  if (!secret) return undefined;
  const token = mintUnsubToken({ userId, category: prefCategory, issuedAt: nowMs }, secret);
  const url = `${APP_URL}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// --- Service-role reads/writes. The client is untyped, so shapes are read defensively. ---

async function isSuppressed(admin: SupabaseClient, email: string): Promise<boolean> {
  const { data } = await admin
    .from("email_suppressions")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  return !!data;
}

async function loadPrefs(
  admin: SupabaseClient,
  userId: string,
  prefCategory: PrefCategory | null,
): Promise<{ unsubscribedAll: boolean; categoryEnabled: boolean }> {
  const { data } = await admin
    .from("email_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  // No row yet → defaults (all on). Missing column value → treat as on.
  const row = (data ?? null) as Record<string, unknown> | null;
  const unsubscribedAll = row?.["unsubscribed_all"] === true;
  const categoryEnabled = prefCategory ? row?.[prefCategory] !== false : true;
  return { unsubscribedAll, categoryEnabled };
}

async function loadLastLifecycle(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("last_lifecycle_email_at")
    .eq("id", userId)
    .maybeSingle();
  const val = (data as { last_lifecycle_email_at?: string | null } | null)?.last_lifecycle_email_at;
  return val ?? null;
}

async function loadSubscription(
  admin: SupabaseClient,
  userId: string,
): Promise<{ status: string; current_period_end: string | null } | null> {
  const { data } = await admin
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { status: string; current_period_end: string | null } | null) ?? null;
}

async function claimSend(
  admin: SupabaseClient,
  job: SendJob,
  dedupKey: string,
): Promise<{ claimed: true; id: string } | { claimed: false }> {
  const { data, error } = await admin
    .from("email_sends")
    .insert({
      user_id: job.userId,
      template: job.template,
      category: templateMeta(job.template).category,
      dedup_key: dedupKey,
      status: "queued",
      scheduled_for: job.scheduledFor ?? null,
      meta: job.meta ?? {},
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation on the partial index → a live row already owns this key.
    if (error.code === "23505") return { claimed: false };
    throw error;
  }
  return { claimed: true, id: (data as { id: string }).id };
}

async function writeLedger(
  admin: SupabaseClient,
  job: SendJob,
  dedupKey: string,
  status: EmailStatus,
  extra: { error?: string } = {},
): Promise<void> {
  await admin.from("email_sends").insert({
    user_id: job.userId,
    template: job.template,
    category: templateMeta(job.template).category,
    dedup_key: dedupKey,
    status,
    scheduled_for: job.scheduledFor ?? null,
    error: extra.error ?? null,
    meta: job.meta ?? {},
  });
}

async function markStatus(
  admin: SupabaseClient,
  id: string,
  status: EmailStatus,
  extra: { resend_id?: string | null; sent_at?: string; error?: string } = {},
): Promise<void> {
  await admin
    .from("email_sends")
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...(extra.resend_id !== undefined ? { resend_id: extra.resend_id } : {}),
      ...(extra.sent_at !== undefined ? { sent_at: extra.sent_at } : {}),
      ...(extra.error !== undefined ? { error: extra.error } : {}),
    })
    .eq("id", id);
}

async function stampLifecycle(
  admin: SupabaseClient,
  userId: string,
  nowMs: number,
): Promise<void> {
  await admin
    .from("profiles")
    .update({ last_lifecycle_email_at: new Date(nowMs).toISOString() })
    .eq("id", userId);
}
