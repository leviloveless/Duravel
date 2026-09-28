import {
  ACCOUNT_FILTERS,
  matchesFilter,
  safeAnnouncementLink,
  type AccountFilter,
  type AccountLite,
} from "@/lib/admin-account-rules";

/**
 * Emailing a group of athletes from the admin (2026-09-28) — the pure rules.
 *
 * A broadcast is marketing mail as far as the law is concerned, so it travels
 * the suppressible "lifecycle" path through `sendEmail`: the athlete's global
 * unsubscribe and their "product updates" preference are honoured, it carries a
 * one-click unsubscribe, and the footer must show a physical postal address
 * (CAN-SPAM). The address comes from EMAIL_POSTAL_ADDRESS; with it unset,
 * nothing can be sent — see `postalAddressFrom`.
 */

/** Segments you can email. Suspended and revoked accounts are never offered. */
export const BROADCAST_SEGMENTS: readonly { key: AccountFilter; label: string }[] =
  ACCOUNT_FILTERS.filter((f) => f.key !== "suspended" && f.key !== "revoked").map((f) =>
    f.key === "all" ? { key: f.key, label: "Everyone (not suspended)" } : f,
  );

/** At most this many sends per click; a larger group resumes on the next click. */
export const BROADCAST_BATCH = 250;

export type BroadcastInput = {
  segment: AccountFilter;
  subject: string;
  paragraphs: string[];
  button: { label: string; url: string } | null;
};

/** Validate the compose form. Throws a message fit to show the admin. */
export function parseBroadcast(raw: {
  segment: string;
  subject: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
}): BroadcastInput {
  const segment = BROADCAST_SEGMENTS.find((s) => s.key === raw.segment)?.key;
  if (!segment) throw new Error("Choose who it goes to.");
  const subject = raw.subject.trim().replace(/\s+/g, " ");
  if (subject.length < 3 || subject.length > 120) {
    throw new Error("The subject must be 3–120 characters.");
  }
  const body = raw.body.replace(/\r\n/g, "\n").trim();
  if (body.length < 10) throw new Error("Write a message of at least a sentence.");
  if (body.length > 5000) throw new Error("Keep the message under 5,000 characters.");
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length > 20) throw new Error("Keep it to 20 paragraphs or fewer.");

  const label = raw.buttonLabel.trim();
  const urlText = raw.buttonUrl.trim();
  let button: BroadcastInput["button"] = null;
  if (label || urlText) {
    if (!label || !urlText) throw new Error("A button needs both a label and a link.");
    if (label.length > 40) throw new Error("Keep the button label under 40 characters.");
    const url = safeAnnouncementLink(urlText);
    if (!url)
      throw new Error("The button link must be https:// or a path on this site like /library.");
    button = { label, url };
  }
  return { segment, subject, paragraphs, button };
}

/** A site-relative button link becomes absolute — email clients have no base URL. */
export function absoluteLink(url: string, siteUrl: string): string {
  return url.startsWith("/") ? `${siteUrl.replace(/\/+$/, "")}${url}` : url;
}

/** The accounts a segment reaches: matching, not suspended, with a confirmed email. */
export function broadcastRecipients<T extends AccountLite & { emailConfirmed: boolean }>(
  accounts: readonly T[],
  segment: AccountFilter,
): T[] {
  return accounts.filter(
    (a) => !a.suspended && a.emailConfirmed && !!a.email && matchesFilter(a, segment),
  );
}

/** To send, the admin types the number of recipients — a count, not a yes. */
export function sendConfirmationMatches(typed: string, recipients: number): boolean {
  return typed.trim() !== "" && Number(typed.trim().replace(/,/g, "")) === recipients;
}

/**
 * The postal address for the footer, or null when none is set. Anything shorter
 * than a plausible address is treated as unset rather than printed.
 */
export function postalAddressFrom(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  return s.length >= 10 ? s : null;
}

/** Idempotency key: one send per athlete per broadcast, so a second click resumes. */
export function broadcastKey(broadcastId: string, userId: string): string {
  return `broadcast:${broadcastId}:${userId}`;
}

const BROADCAST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBroadcastId(s: string): boolean {
  return BROADCAST_ID.test(s);
}
