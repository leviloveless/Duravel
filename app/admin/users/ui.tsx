import Link from "next/link";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/admin-account-rules";

/**
 * Small presentational pieces shared by the account admin pages. Server
 * components only — nothing here needs the browser, so the whole admin ships
 * without client JavaScript. Destructive actions confirm with a <details>
 * disclosure: the first click reveals the real button, and nothing is sent until
 * the second.
 */

const TZ = "America/Chicago";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * A CALENDAR date ("2026-09-28") — a program start, a race day. Formatted as the
 * date it names, with NO timezone conversion: read as an instant it is UTC
 * midnight, which is the previous evening in Central time, and "starts Sep 28"
 * would print as "Sep 27". Same bug class as a date of birth; see
 * lib/signup-checks.ts.
 */
export function fmtCalendarDate(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return fmtDate(ymd);
  const [, y, mo, d] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} CT`;
}

export function fmtUnix(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  return fmtDate(new Date(seconds * 1000).toISOString());
}

const TONES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  blue: "bg-accent-wash text-accent ring-accent/30",
  zinc: "bg-zinc-100 text-zinc-700 ring-zinc-200",
};

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">{children}</p>
  );
}

export function Card({
  title,
  aside,
  tone = "default",
  children,
}: {
  title: string;
  aside?: ReactNode;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border bg-white p-5 ${tone === "danger" ? "border-red-200" : "border-line"}`}
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className={`text-sm font-semibold ${tone === "danger" ? "text-red-800" : "text-ink"}`}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-100 py-1.5 text-sm last:border-0">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right text-zinc-900">{children}</span>
    </div>
  );
}

export const inputCls =
  "w-full rounded-md border border-line-strong bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
export const labelCls = "mb-1 block text-xs font-medium text-zinc-600";
export const btnCls =
  "inline-flex items-center justify-center rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800";
export const btnSecondaryCls =
  "inline-flex items-center justify-center rounded-md border border-line-strong bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50";
export const btnDangerCls =
  "inline-flex items-center justify-center rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800";

/** A destructive button behind a disclosure: reveal, then confirm. No JavaScript. */
export function ConfirmButton({
  label,
  confirmLabel,
  warning,
  children,
}: {
  label: string;
  confirmLabel: string;
  warning?: string;
  children?: ReactNode;
}) {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 [&::-webkit-details-marker]:hidden">
        {label}
      </summary>
      <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3">
        {warning ? <p className="mb-2 text-xs leading-relaxed text-red-900">{warning}</p> : null}
        {children}
        <button type="submit" className={btnDangerCls}>
          {confirmLabel}
        </button>
      </div>
    </details>
  );
}

const OK_TEXT: Record<string, string> = {
  access_default: "Access returned to the normal billing rules.",
  access_grant: "Comp saved — free access, no card needed.",
  access_revoke: "Access revoked.",
  trial_extended: "Trial end moved in Stripe. The card is charged on the new date.",
  trial_ended_now: "Trial ended in Stripe — the card is charged today.",
  profile_saved: "Profile saved.",
  profile_created: "Profile row created. Their trial clock was kept at their signup date.",
  email_changed: "Email changed.",
  reset_sent: "Password reset email sent.",
  invited: "Invitation sent. They'll get an email with a link to set a password.",
  suspended:
    "Account suspended. They can't sign in; a session already open may last up to an hour.",
  unsuspended: "Account restored.",
  deleted: "Account permanently deleted.",
  program_deleted: "Program deleted.",
  sub_canceled:
    "Subscription canceled in Stripe. The app will update when Stripe's webhook arrives.",
  sub_cancel_scheduled: "Subscription set to cancel at the end of the period.",
  sub_resumed: "Scheduled cancellation removed.",
  refunded: "Refund issued in Stripe.",
  mfa: "Two-factor verified for this session.",
  announcement_published: "Announcement is live for signed-in athletes.",
  announcement_ended: "Announcement taken down.",
  promo_created: "Promo code created in Stripe.",
  promo_on: "Promo code reactivated.",
  promo_off: "Promo code deactivated. Existing discounts keep running; nobody new can redeem it.",
};

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
      >
        {error}
      </div>
    );
  }
  if (ok) {
    return (
      <div
        role="status"
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
      >
        {OK_TEXT[ok] ?? "Saved."}
      </div>
    );
  }
  return null;
}

export function MigrationBanner() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      Migration <span className="font-mono">0048_admin.sql</span> hasn&apos;t been applied, so
      access overrides and the audit log are unavailable. Run it in the Supabase SQL editor.
      Everything else here works.
    </div>
  );
}

export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const NAV = [
  { href: "/admin/users", label: "Accounts" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/promos", label: "Promo codes" },
  { href: "/admin/mfa", label: "Two-factor" },
  { href: "/admin", label: "Other admin" },
] as const;

/** One row of links across every account-admin page. */
export function AdminNav({ current }: { current: (typeof NAV)[number]["href"] }) {
  return (
    <nav
      aria-label="Admin"
      className="border-line -mx-1 flex flex-wrap gap-1 border-b pb-3 text-sm"
    >
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={n.href === current ? "page" : undefined}
          className={`rounded-md px-2.5 py-1 ${
            n.href === current
              ? "bg-ink text-white"
              : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
          }`}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
