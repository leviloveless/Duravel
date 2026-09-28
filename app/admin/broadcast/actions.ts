"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/admin-access";
import { recordAdminAction } from "@/lib/admin-audit";
import { listAccounts } from "@/lib/admin-accounts";
import {
  BROADCAST_BATCH,
  absoluteLink,
  broadcastRecipients,
  isBroadcastId,
  parseBroadcast,
  postalAddressFrom,
  sendConfirmationMatches,
  type BroadcastInput,
} from "@/lib/admin-broadcast";
import { alreadySentUserIds } from "@/lib/admin-broadcast-data";
import { emailEnabled } from "@/lib/email/resend";
import { sendEmail } from "@/lib/email/send";
import { mintUnsubToken } from "@/lib/email/unsubscribe";
import type { BroadcastProps } from "@/lib/email/templates/types";

/**
 * Send a group email (2026-09-28). The action calls `requireAdmin()` first — a
 * server action is a public endpoint.
 *
 * Mail goes one athlete at a time through `sendEmail`, so each send honours
 * suppression, the athlete's unsubscribe and product-updates preference, the
 * once-a-day lifecycle cap, and gets its own ledger row. Sends are spaced to
 * stay under Resend's default two-requests-per-second limit, and at most
 * BROADCAST_BATCH go per click; the idempotency key (broadcast + athlete) means
 * clicking Send again carries on where the last batch stopped, never repeating.
 */

const SPACING_MS = 550;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type BroadcastValues = {
  segment: string;
  subject: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
};

/**
 * Returned to the form rather than redirected, so the admin's text survives a
 * validation error, a test send, or a batch that stopped at the limit.
 */
export type BroadcastState = {
  status: "idle" | "ok" | "error";
  message: string;
  broadcastId: string;
  values: BroadcastValues;
};

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

function siteUrl(): string {
  return (env.NEXT_PUBLIC_SITE_URL ?? "https://duravel.app").replace(/\/+$/, "");
}

function propsFor(
  input: BroadcastInput,
  userId: string,
  firstName: string,
  postalAddress: string,
  secret: string,
  nowMs: number,
): BroadcastProps {
  const base = siteUrl();
  const token = mintUnsubToken({ userId, category: "product", issuedAt: nowMs }, secret);
  return {
    firstName,
    subject: input.subject,
    paragraphs: input.paragraphs,
    button: input.button
      ? { label: input.button.label, url: absoluteLink(input.button.url, base) }
      : null,
    unsubscribeUrl: `${base}/api/email/unsubscribe?token=${encodeURIComponent(token)}`,
    manageUrl: `${base}/settings/email`,
    postalAddress,
  };
}

export async function sendBroadcast(
  _prev: BroadcastState,
  form: FormData,
): Promise<BroadcastState> {
  const actor = await requireAdmin();
  const broadcastId = field(form, "broadcastId");
  const mode = field(form, "mode") === "send" ? "send" : "test";
  const values: BroadcastValues = {
    segment: field(form, "segment"),
    subject: field(form, "subject"),
    body: field(form, "body"),
    buttonLabel: field(form, "buttonLabel"),
    buttonUrl: field(form, "buttonUrl"),
  };
  let outcome: { status: "ok" | "error"; message: string };
  try {
    if (!isBroadcastId(broadcastId)) throw new Error("This form is out of date — reload the page.");
    const input = parseBroadcast(values);
    const postal = postalAddressFrom(env.EMAIL_POSTAL_ADDRESS);
    if (!postal) throw new Error("Set EMAIL_POSTAL_ADDRESS in Vercel before sending group email.");
    const secret = env.EMAIL_UNSUB_SECRET;
    if (!secret) {
      throw new Error("Set EMAIL_UNSUB_SECRET so every email carries a working unsubscribe link.");
    }
    if (!emailEnabled()) {
      throw new Error("Email is switched off (EMAIL_ENABLED), so nothing would be sent.");
    }
    const nowMs = Date.now();

    if (mode === "test") {
      const firstName = (actor.email ?? "").split("@")[0] || "there";
      const result = await sendEmail({
        userId: actor.id,
        template: "broadcast",
        dedup: {
          template: "broadcast",
          broadcastId: `${broadcastId}-test-${nowMs}`,
          userId: actor.id,
        },
        render: {
          template: "broadcast",
          props: propsFor(input, actor.id, firstName, postal, secret, nowMs),
        },
        meta: { flow: "broadcast_test", broadcast: broadcastId },
        test: true,
      });
      outcome =
        result.status === "sent"
          ? { status: "ok", message: `Test sent to ${actor.email ?? "your address"}.` }
          : { status: "error", message: `Test not sent (${result.status}: ${result.reason}).` };
    } else {
      const { accounts } = await listAccounts();
      const recipients = broadcastRecipients(accounts, input.segment);
      if (!sendConfirmationMatches(field(form, "confirm"), recipients.length)) {
        throw new Error(`Type ${recipients.length} (the number of recipients) to confirm.`);
      }
      const done = await alreadySentUserIds(broadcastId);
      const pending = recipients.filter((a) => !done.has(a.id));
      const batch = pending.slice(0, BROADCAST_BATCH);
      const tally = { sent: 0, skipped: 0, failed: 0 };
      for (const [i, a] of batch.entries()) {
        if (i > 0) await sleep(SPACING_MS);
        const firstName = a.name?.split(" ")[0] || "there";
        const result = await sendEmail({
          userId: a.id,
          template: "broadcast",
          dedup: { template: "broadcast", broadcastId, userId: a.id },
          render: {
            template: "broadcast",
            props: propsFor(input, a.id, firstName, postal, secret, nowMs),
          },
          meta: { flow: "broadcast", broadcast: broadcastId },
        });
        tally[result.status]++;
      }
      const remaining = pending.length - batch.length;
      await recordAdminAction(
        createAdminClient(),
        actor,
        { id: null, email: null },
        "email.broadcast",
        {
          broadcast_id: broadcastId,
          segment: input.segment,
          subject: input.subject,
          paragraphs: input.paragraphs,
          button: input.button,
          recipients: recipients.length,
          batch: tally,
          sent_so_far: recipients.length - pending.length + tally.sent,
          remaining,
        },
      );
      outcome = {
        status: "ok",
        message:
          `Sent ${tally.sent}, skipped ${tally.skipped} (unsubscribed, already emailed today, or already sent), failed ${tally.failed}.` +
          (remaining > 0 ? ` ${remaining} still to go — press Send again to continue.` : " Done."),
      };
    }
  } catch (err) {
    outcome = { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
  return { ...outcome, broadcastId, values };
}
