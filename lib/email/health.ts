import type { EmailStatus, EmailTemplate, GateSkipReason } from "./types";

/**
 * Email health rollup — PURE, so it can be unit-tested without a database.
 *
 * ## Why this exists
 *
 * Nothing in the app surfaced `email_sends`. The only ways to answer "is email
 * actually sending?" were the Resend dashboard or the Vercel env list, and on
 * 2026-08-13 that gap cost real time: a stale note claimed the system was gated
 * off, it had in fact been live since 2026-07-20, and the work was very nearly
 * done twice. A system with no observable state gets re-litigated from memory.
 *
 * ## The trick that makes this definitive
 *
 * `sendEmail()` records a `skipped` row for every gated send and stores the
 * `GateSkipReason` in the `error` column — including **`disabled`**, which is
 * written when and only when `emailEnabled()` is false. So the ledger itself
 * proves the flag state; we never have to guess at env. That is what
 * `verdict` reports, and it is the one number worth looking at.
 *
 * A `skipped` row is NOT a failure. `unsubscribed_all`, `category_off` and
 * `frequency_cap` are the system working as designed, and they are counted
 * separately from the ones that mean something is wrong.
 */

/** The subset of an `email_sends` row this rollup needs. */
export type EmailSendRow = {
  template: string;
  category: string;
  status: string;
  /** For a `skipped` row this holds the GateSkipReason; for `failed`, the error. */
  error: string | null;
  created_at: string;
};

/** What the ledger says about whether email is actually going out. */
export type EmailVerdict =
  | "sending" // real sends landed in the window
  | "gated_off" // a 'disabled' skip proves EMAIL_ENABLED is not "true"
  | "attempting_but_failing" // attempts exist, none succeeded
  | "suppressed_only" // only preference/frequency skips — working as designed
  | "no_activity"; // nothing attempted at all

export type StatusCounts = Record<string, number>;

export type TemplateRollup = {
  template: string;
  total: number;
  /** Reached the provider (sent/delivered/opened/clicked). */
  sent: number;
  delivered: number;
  opened: number;
  bounced: number;
  complained: number;
  failed: number;
  skipped: number;
};

export type EmailHealth = {
  verdict: EmailVerdict;
  /** One line of plain English for the headline. */
  headline: string;
  windowDays: number;
  total: number;
  byStatus: StatusCounts;
  byTemplate: TemplateRollup[];
  /** Counts of GateSkipReason across `skipped` rows, most common first. */
  skipReasons: Array<{ reason: string; count: number }>;
  /** Sends that reached the provider — the number that means "it works". */
  reachedProvider: number;
  /** Most recent created_at across rows that reached the provider, or null. */
  lastSendAt: string | null;
  /** delivered / reachedProvider, 0–1, or null when nothing was sent. */
  deliveryRate: number | null;
};

/** Statuses that mean Resend accepted the message. */
const REACHED: ReadonlySet<string> = new Set(["sent", "delivered", "opened", "clicked"]);

/** Skip reasons that are the system working correctly, not a problem. */
const BENIGN_SKIPS: ReadonlySet<string> = new Set([
  "unsubscribed_all",
  "category_off",
  "frequency_cap",
  "now_subscribed",
  "duplicate",
]);

/** Templates we always want a row for, even at zero, so a silent one is visible. */
const KNOWN_TEMPLATES: readonly EmailTemplate[] = [
  "welcome",
  "onboarding_nudge",
  "trial_ending",
  "receipt",
];

function emptyRollup(template: string): TemplateRollup {
  return {
    template,
    total: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    bounced: 0,
    complained: 0,
    failed: 0,
    skipped: 0,
  };
}

/**
 * Roll up raw `email_sends` rows into the panel's view.
 *
 * `windowDays` is passed in rather than computed so this stays pure — the repo's
 * engine audits rely on `Date.now()` never being called inside testable code.
 */
export function rollupEmailHealth(rows: readonly EmailSendRow[], windowDays = 30): EmailHealth {
  const byStatus: StatusCounts = {};
  const templates = new Map<string, TemplateRollup>();
  for (const t of KNOWN_TEMPLATES) templates.set(t, emptyRollup(t));
  const skips = new Map<string, number>();

  let reachedProvider = 0;
  let delivered = 0;
  let lastSendAt: string | null = null;
  let sawDisabled = false;

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    const roll = templates.get(r.template) ?? emptyRollup(r.template);
    templates.set(r.template, roll);
    roll.total += 1;

    if (REACHED.has(r.status)) {
      reachedProvider += 1;
      roll.sent += 1;
      // Rows advance forward-only, so anything at or past `delivered` counts.
      if (r.status !== "sent") {
        delivered += 1;
        roll.delivered += 1;
      }
      if (r.status === "opened" || r.status === "clicked") roll.opened += 1;
      if (!lastSendAt || r.created_at > lastSendAt) lastSendAt = r.created_at;
    }
    if (r.status === "bounced") roll.bounced += 1;
    if (r.status === "complained") roll.complained += 1;
    if (r.status === "failed") roll.failed += 1;
    if (r.status === "skipped") {
      roll.skipped += 1;
      const reason = r.error ?? "unknown";
      skips.set(reason, (skips.get(reason) ?? 0) + 1);
      if (reason === ("disabled" satisfies GateSkipReason)) sawDisabled = true;
    }
  }

  const total = rows.length;
  const failedOrBounced =
    (byStatus.failed ?? 0) + (byStatus.bounced ?? 0) + (byStatus.complained ?? 0);

  // Order matters. `gated_off` outranks everything: a 'disabled' skip is direct
  // evidence about the kill switch, and it is the question this panel exists to
  // answer. It is checked even when other sends succeeded, because the flag can
  // be turned off part-way through a window.
  let verdict: EmailVerdict;
  let headline: string;
  if (sawDisabled) {
    verdict = "gated_off";
    headline =
      reachedProvider > 0
        ? `EMAIL_ENABLED is OFF — ${reachedProvider} email(s) went out earlier in this window, and sends have been skipped since.`
        : "EMAIL_ENABLED is OFF — every send in this window was skipped before reaching Resend.";
  } else if (reachedProvider > 0) {
    verdict = "sending";
    headline = `Sending — ${reachedProvider} email(s) reached Resend in the last ${windowDays} days.`;
  } else if (failedOrBounced > 0) {
    verdict = "attempting_but_failing";
    headline = `Attempting but not delivering — ${failedOrBounced} failed, bounced or complained and none succeeded.`;
  } else if (total > 0) {
    verdict = "suppressed_only";
    headline = `No sends, but nothing is broken — all ${total} were skipped by preference, frequency or dedup rules.`;
  } else {
    verdict = "no_activity";
    headline = `No email activity at all in the last ${windowDays} days — check the daily cron is running.`;
  }

  return {
    verdict,
    headline,
    windowDays,
    total,
    byStatus,
    byTemplate: [...templates.values()].sort(
      (a, b) => b.total - a.total || a.template.localeCompare(b.template),
    ),
    skipReasons: [...skips.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    reachedProvider,
    lastSendAt,
    deliveryRate: reachedProvider > 0 ? delivered / reachedProvider : null,
  };
}

/** True when a skip reason means the system behaved correctly. */
export function isBenignSkip(reason: string): boolean {
  return BENIGN_SKIPS.has(reason);
}

/** Human label for a skip reason. */
export function skipReasonLabel(reason: string): string {
  const map: Record<string, string> = {
    disabled: "EMAIL_ENABLED is off",
    no_recipient: "No email address on file",
    suppressed: "Address suppressed (bounce/complaint)",
    unsubscribed_all: "Unsubscribed from everything",
    category_off: "Category turned off in preferences",
    frequency_cap: "Frequency cap",
    now_subscribed: "Already subscribed (trial email no longer applies)",
    duplicate: "Duplicate — already sent",
    unknown: "Unrecorded",
  };
  return map[reason] ?? reason;
}

export type { EmailStatus };
