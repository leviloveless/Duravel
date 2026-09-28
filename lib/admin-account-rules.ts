import type { AccessSource, ResolvedAccess } from "@/lib/subscription";

/**
 * Pure rules behind the account admin: status labels, filtering, search, and the
 * few checks that decide whether a dangerous action may proceed. No I/O, so every
 * one of them is tested directly.
 */

export type AccountFilter =
  | "all"
  | "trial"
  | "subscribed"
  | "no_card"
  | "lapsed"
  | "comped"
  | "revoked"
  | "suspended"
  | "no_profile";

/**
 * The card-on-file model's states (2026-09-20). "On trial" is a Stripe trial —
 * card given, not yet charged. "No card yet" is everyone who signed up and never
 * checked out: the paywall's audience, and the largest group by design.
 * "Lapsed" had a subscription or trial that is no longer live.
 */
export const ACCOUNT_FILTERS: readonly { key: AccountFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "trial", label: "On trial" },
  { key: "subscribed", label: "Subscribed" },
  { key: "no_card", label: "No card yet" },
  { key: "lapsed", label: "Lapsed" },
  { key: "comped", label: "Comped" },
  { key: "revoked", label: "Revoked" },
  { key: "suspended", label: "Suspended" },
  { key: "no_profile", label: "No profile" },
];

export function parseFilter(raw: string | undefined): AccountFilter {
  return ACCOUNT_FILTERS.some((f) => f.key === raw) ? (raw as AccountFilter) : "all";
}

/** The subset of an account the list rules need. */
export type AccountLite = {
  id: string;
  email: string | null;
  name: string | null;
  hasProfile: boolean;
  suspended: boolean;
  access: Pick<ResolvedAccess, "entitled" | "source">;
};

/**
 * Whether an auth user's ban is in force. Supabase stores the ban as
 * `banned_until`; an absent or past timestamp means not banned.
 */
export function isSuspended(bannedUntil: string | null | undefined, nowMs: number): boolean {
  if (!bannedUntil) return false;
  const t = Date.parse(bannedUntil);
  return Number.isFinite(t) && t > nowMs;
}

export type Tone = "green" | "amber" | "red" | "zinc" | "blue";

/**
 * One chip per account. Suspension outranks everything, because a suspended
 * athlete cannot sign in whatever their billing says, and that is the fact the
 * admin most needs to see.
 */
export function accessLabel(
  access: Pick<ResolvedAccess, "source" | "trialDaysLeft">,
  suspended: boolean,
): { label: string; tone: Tone } {
  if (suspended) return { label: "Suspended", tone: "red" };
  const s: AccessSource = access.source;
  switch (s) {
    case "billing_off":
      return { label: "Billing off", tone: "zinc" };
    case "override_revoke":
      return { label: "Revoked", tone: "red" };
    case "override_grant":
      return { label: "Comped", tone: "blue" };
    case "subscription":
      return { label: "Subscribed", tone: "green" };
    case "trial": {
      const d = access.trialDaysLeft ?? 0;
      return { label: `Trial · ${d} day${d === 1 ? "" : "s"} left`, tone: "amber" };
    }
    case "lapsed":
      return { label: "Lapsed", tone: "zinc" };
    case "none":
      return { label: "No card yet", tone: "zinc" };
  }
}

export function matchesFilter(a: AccountLite, filter: AccountFilter): boolean {
  // A suspended account is filed under Suspended only, never under a billing
  // state — the chip says "Suspended", and "On trial" should mean someone who
  // can actually use the trial.
  if (a.suspended && filter !== "all" && filter !== "suspended" && filter !== "no_profile")
    return false;
  switch (filter) {
    case "all":
      return true;
    case "suspended":
      return a.suspended;
    case "no_profile":
      return !a.hasProfile;
    case "trial":
      return a.access.source === "trial";
    case "no_card":
      return a.access.source === "none";
    case "lapsed":
      return a.access.source === "lapsed";
    case "subscribed":
      return a.access.source === "subscription";
    case "comped":
      return a.access.source === "override_grant";
    case "revoked":
      return a.access.source === "override_revoke";
  }
}

/** Case-insensitive match on email, name, or an exact user id. */
export function matchesQuery(a: AccountLite, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (a.id.toLowerCase() === q) return true;
  return (a.email ?? "").toLowerCase().includes(q) || (a.name ?? "").toLowerCase().includes(q);
}

/** Split into batches, so an `.in("id", ids)` never outgrows a URL. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The type-to-confirm check for a permanent delete. The admin must type the
 * account's email exactly (case-insensitive) — a click, or a near-miss, is not
 * enough for something that cannot be undone.
 */
export function deleteConfirmationMatches(typed: string, accountEmail: string | null): boolean {
  if (!accountEmail) return false;
  return typed.trim().toLowerCase() === accountEmail.trim().toLowerCase() && typed.trim() !== "";
}

/**
 * Whether an action would lock the administrator out of their own account.
 * Suspending, revoking or deleting yourself is refused outright; there is no
 * second administrator to undo it.
 */
export function isSelfLockout(adminId: string, targetId: string): boolean {
  return adminId === targetId;
}

/** "grant for N days" as an absolute expiry, or null for open-ended. */
export function expiryFromDays(days: number | null, nowMs: number): string | null {
  if (days === null) return null;
  if (!Number.isFinite(days) || days <= 0) throw new Error("days must be a positive number");
  return new Date(nowMs + Math.round(days) * 24 * 60 * 60 * 1000).toISOString();
}

/** Display a money amount in minor units ("$12.99"). */
export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export type CsvCell = string | number | boolean | null | undefined;

/**
 * One CSV field. Quoted when it has to be, and DEFUSED when it starts like a
 * formula: an athlete who signs up as `=HYPERLINK("http://evil","click")` would
 * otherwise become a live formula the moment this file opens in Excel or
 * Sheets. A leading apostrophe makes the spreadsheet show it as text.
 */
export function csvField(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Strings only: a real negative NUMBER is data, not an injected formula.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text, CRLF line endings (what Excel expects). */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

// ─── activity ─────────────────────────────────────────────────────────────────

export type ActivitySummary = {
  logged: number;
  completed: number;
  partial: number;
  skipped: number;
  /** Sessions logged in the last 14 days, any status. */
  last14: number;
  lastLoggedAt: string | null;
  extras: number;
  lastExtraAt: string | null;
};

const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

export function summarizeActivity(
  logs: readonly { status: string; logged_at: string | null }[],
  extras: readonly { created_at: string | null }[],
  nowMs: number,
): ActivitySummary {
  const latest = (xs: readonly (string | null)[]) =>
    xs.reduce<string | null>((best, x) => (x && (!best || x > best) ? x : best), null);
  return {
    logged: logs.length,
    completed: logs.filter((l) => l.status === "completed").length,
    partial: logs.filter((l) => l.status === "partial").length,
    skipped: logs.filter((l) => l.status === "skipped").length,
    last14: logs.filter((l) => l.logged_at && nowMs - Date.parse(l.logged_at) <= FOURTEEN_DAYS)
      .length,
    lastLoggedAt: latest(logs.map((l) => l.logged_at)),
    extras: extras.length,
    lastExtraAt: latest(extras.map((e) => e.created_at)),
  };
}

// ─── announcements ────────────────────────────────────────────────────────────

/**
 * A link an announcement may carry: a path on this site, or an https URL.
 * Anything else — `javascript:`, `data:`, plain http — is refused, because this
 * lands in an href on every signed-in page.
 */
export function safeAnnouncementLink(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return null;
  if (/^\/(?!\/)[^\s]*$/.test(s)) return s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ─── promo codes ──────────────────────────────────────────────────────────────

export type PromoInput = {
  code: string;
  percentOff: string;
  amountOff: string;
  duration: string;
  months: string;
  maxRedemptions: string;
  expiresInDays: string;
  firstTimeOnly: boolean;
};

export type PromoPlan = {
  code: string;
  discount: { percent_off: number } | { amount_off: number; currency: "usd" };
  duration: "once" | "forever" | "repeating";
  durationInMonths: number | null;
  maxRedemptions: number | null;
  expiresAt: number | null; // unix seconds
  firstTimeOnly: boolean;
};

/**
 * Validate the promo form into exactly what Stripe will be asked for. Pure, so
 * every refusal is tested — a malformed coupon is a real-money mistake.
 */
export function parsePromo(
  i: PromoInput,
  nowMs: number,
): { ok: true; plan: PromoPlan } | { ok: false; error: string } {
  const code = i.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) {
    return { ok: false, error: "Code: 3–40 characters, letters, numbers, - or _." };
  }
  const pct = i.percentOff.trim();
  const amt = i.amountOff.trim();
  if ((pct === "") === (amt === ""))
    return {
      ok: false,
      error: "Give either a percent off or a dollar amount off — one, not both.",
    };
  let discount: PromoPlan["discount"];
  if (pct !== "") {
    const n = Number(pct);
    if (!Number.isFinite(n) || n <= 0 || n > 100)
      return { ok: false, error: "Percent off must be between 1 and 100." };
    discount = { percent_off: Math.round(n * 100) / 100 };
  } else {
    const n = Number(amt.replace(/^\$/, ""));
    if (!Number.isFinite(n) || n <= 0 || n > 1000)
      return { ok: false, error: "Amount off must be between $0.01 and $1,000." };
    discount = { amount_off: Math.round(n * 100), currency: "usd" };
  }
  const duration =
    i.duration === "forever" || i.duration === "repeating"
      ? i.duration
      : i.duration === "once"
        ? "once"
        : null;
  if (!duration) return { ok: false, error: "Choose how long the discount lasts." };
  let durationInMonths: number | null = null;
  if (duration === "repeating") {
    const m = Number(i.months);
    if (!Number.isInteger(m) || m < 1 || m > 36)
      return { ok: false, error: "Months must be a whole number, 1–36." };
    durationInMonths = m;
  }
  let maxRedemptions: number | null = null;
  if (i.maxRedemptions.trim() !== "") {
    const m = Number(i.maxRedemptions);
    if (!Number.isInteger(m) || m < 1)
      return { ok: false, error: "Max uses must be a whole number of at least 1." };
    maxRedemptions = m;
  }
  let expiresAt: number | null = null;
  if (i.expiresInDays.trim() !== "") {
    const d = Number(i.expiresInDays);
    if (!Number.isInteger(d) || d < 1 || d > 3650)
      return { ok: false, error: "Expires in must be 1–3650 days." };
    expiresAt = Math.floor(nowMs / 1000) + d * 86400;
  }
  return {
    ok: true,
    plan: {
      code,
      discount,
      duration,
      durationInMonths,
      maxRedemptions,
      expiresAt,
      firstTimeOnly: i.firstTimeOnly,
    },
  };
}

// ─── two-factor ───────────────────────────────────────────────────────────────

/**
 * A QR code data URL that a browser will actually render.
 *
 * supabase-js hands back `data:image/svg+xml;utf-8,<svg …>` with the SVG
 * UNENCODED. That renders only while the SVG happens to contain no `#` — the
 * first `#` starts a URL fragment and truncates the image, so one colour written
 * as `#000` would turn setup into a broken image. Re-encoding the payload makes
 * it safe whatever the SVG contains. Already-encoded input is decoded first, so
 * this is idempotent.
 */
export function normalizeSvgDataUrl(raw: string): string {
  const comma = raw.indexOf(",");
  if (!raw.startsWith("data:image/svg+xml") || comma < 0) return raw;
  let payload = raw.slice(comma + 1);
  if (!payload.includes("<")) {
    try {
      payload = decodeURIComponent(payload);
    } catch {
      return raw;
    }
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(payload)}`;
}

// ─── creating an account by hand (2026-09-28) ─────────────────────────────────

/**
 * How a hand-made account's owner gets in.
 * - `set_password`: the account is created confirmed, and they are emailed a
 *   link to choose a password (the same email "Forgot password" sends).
 * - `invite`: Supabase's invitation email; the account stays unconfirmed until
 *   they click it.
 * - `none`: nothing is sent. They can sign in with Google on the same address,
 *   or use "Forgot password" whenever they like.
 */
export type NewAccountOnboarding = "set_password" | "invite" | "none";

export type NewAccount = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  onboarding: NewAccountOnboarding;
  comp: { tier: "standard" | "custom"; days: number | null } | null;
  note: string | null;
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate the "Add account" form. Throws a message fit to show the admin. */
export function parseNewAccount(raw: {
  email: string;
  firstName: string;
  lastName: string;
  onboarding: string;
  access: string;
  tier: string;
  days: string;
  note: string;
}): NewAccount {
  const email = raw.email.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(email)) throw new Error("That doesn't look like an email address.");
  const onboarding: NewAccountOnboarding =
    raw.onboarding === "invite" ? "invite" : raw.onboarding === "none" ? "none" : "set_password";
  let comp: NewAccount["comp"] = null;
  if (raw.access === "grant") {
    const daysText = raw.days.trim();
    const days = daysText === "" ? null : Number(daysText);
    if (days !== null && (!Number.isFinite(days) || days <= 0 || days > 3650)) {
      throw new Error("Comp length must be a number of days between 1 and 3650, or blank.");
    }
    comp = { tier: raw.tier === "custom" ? "custom" : "standard", days };
  }
  const clean = (s: string, max: number) => {
    const t = s.trim().slice(0, max);
    return t === "" ? null : t;
  };
  return {
    email,
    firstName: clean(raw.firstName, 80),
    lastName: clean(raw.lastName, 80),
    onboarding,
    comp,
    note: clean(raw.note, 500),
  };
}

// ─── deleting several accounts at once (2026-09-28) ──────────────────────────

export const BULK_DELETE_MAX = 50;
export const BULK_DELETE_WORD = "DELETE";

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a bulk delete. The admin must type DELETE (any case); ids are
 * deduplicated, malformed ones rejected, and the admin's own account is always
 * removed from the set — there is no second administrator to restore it.
 */
export function parseBulkDelete(
  ids: readonly string[],
  confirm: string,
  adminId: string,
): { ids: string[]; skippedSelf: boolean } {
  if (confirm.trim().toUpperCase() !== BULK_DELETE_WORD) {
    throw new Error(`Type ${BULK_DELETE_WORD} to confirm.`);
  }
  const unique = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
  if (unique.some((id) => !ACCOUNT_ID.test(id))) throw new Error("Invalid account id.");
  const skippedSelf = unique.includes(adminId);
  const rest = unique.filter((id) => id !== adminId);
  if (rest.length === 0) {
    throw new Error(
      skippedSelf ? "You can't delete your own account." : "Select at least one account.",
    );
  }
  if (rest.length > BULK_DELETE_MAX) {
    throw new Error(`Delete at most ${BULK_DELETE_MAX} accounts at a time.`);
  }
  return { ids: rest, skippedSelf };
}

export type BulkDeleteOutcome =
  | { email: string | null; result: "deleted" }
  | { email: string | null; result: "skipped"; reason: string };

/** One sentence for the flash message after a bulk delete. */
export function summarizeBulkDelete(
  outcomes: readonly BulkDeleteOutcome[],
  skippedSelf: boolean,
): string {
  const deleted = outcomes.filter((o) => o.result === "deleted").length;
  const skipped = outcomes.filter(
    (o): o is Extract<BulkDeleteOutcome, { result: "skipped" }> => o.result === "skipped",
  );
  const parts = [`Deleted ${deleted} account${deleted === 1 ? "" : "s"}.`];
  if (skipped.length > 0) {
    parts.push(
      `Skipped ${skipped.length}: ` +
        skipped.map((s) => `${s.email ?? "(no email)"} — ${s.reason}`).join("; ") +
        ".",
    );
  }
  if (skippedSelf) parts.push("Your own account was left alone.");
  return parts.join(" ");
}
