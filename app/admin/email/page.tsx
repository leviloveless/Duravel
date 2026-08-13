import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdmin } from "@/lib/admin";
import { getEmailAdminView } from "@/lib/admin-email";
import { isBenignSkip, skipReasonLabel, type EmailVerdict } from "@/lib/email/health";
import { formatInstant } from "@/lib/timezone";

/**
 * Admin email health — is the lifecycle system actually sending, and if not, why?
 *
 * Built 2026-08-13 because nothing surfaced `email_sends` at all: the only ways
 * to check were the Resend dashboard or the Vercel env list, and a stale note in
 * project memory claiming the system was gated off (it had been live since
 * 2026-07-20) very nearly caused the go-live work to be done a second time. A
 * system with no observable state gets re-litigated from memory.
 *
 * Read-only, service-role, admin-gated. No migration.
 */
export const dynamic = "force-dynamic";

const VERDICT_STYLE: Record<EmailVerdict, string> = {
  sending: "border-emerald-200 bg-emerald-50 text-emerald-900",
  gated_off: "border-amber-300 bg-amber-50 text-amber-900",
  attempting_but_failing: "border-red-200 bg-red-50 text-red-900",
  suppressed_only: "border-sky-200 bg-sky-50 text-sky-900",
  no_activity: "border-zinc-200 bg-zinc-50 text-zinc-700",
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-900">{value}</div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

export default async function AdminEmailPage() {
  const admin = await getAdmin();
  if (!admin) notFound();

  const { health, suppressions, truncated } = await getEmailAdminView();
  const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="flex flex-col gap-1">
        <Link href="/admin" className="text-sm text-zinc-500 underline">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold">Email health</h1>
        <p className="text-sm text-zinc-500">
          Lifecycle + transactional sends over the last {health.windowDays} days, straight from the{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">email_sends</code> ledger.
        </p>
      </div>

      {/* The headline. A 'disabled' skip is written only when EMAIL_ENABLED is
          not "true", so this states the kill-switch position as fact. */}
      <section className={`rounded-2xl border p-5 ${VERDICT_STYLE[health.verdict]}`}>
        <p className="text-sm font-medium">{health.headline}</p>
        {health.verdict === "gated_off" && (
          <p className="mt-2 text-xs opacity-80">
            Set <code className="rounded bg-white/60 px-1 py-0.5">EMAIL_ENABLED=true</code> on
            Production in Vercel, then <strong>redeploy</strong> — a deployment binds its env at
            create time, so the flag does nothing until one is built after the change.
          </p>
        )}
        {health.verdict === "no_activity" && (
          <p className="mt-2 text-xs opacity-80">
            The daily cron is{" "}
            <code className="rounded bg-white/60 px-1 py-0.5">/api/cron/lifecycle</code> at 14:00
            UTC. It runs even when sending is disabled and writes a row either way, so a complete
            absence points at the cron or at nothing being due — not at the flag.
          </p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Reached Resend" value={String(health.reachedProvider)} sub="sent or better" />
        <Stat label="Delivery rate" value={pct(health.deliveryRate)} sub="of those sent" />
        <Stat label="Ledger rows" value={String(health.total)} sub={`last ${health.windowDays}d`} />
        <Stat
          label="Last send"
          value={
            health.lastSendAt
              ? formatInstant(health.lastSendAt, null, { month: "short", day: "numeric" }, "—")
              : "—"
          }
          sub={health.lastSendAt ? "UTC" : "never"}
        />
      </section>

      <section className="rounded-2xl border border-zinc-200 p-5">
        <h2 className="mb-2 text-sm font-semibold">By template</h2>
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-400">
              <th className="py-1 pr-3 font-medium">Template</th>
              <th className="py-1 pr-3 text-right font-medium">sent</th>
              <th className="py-1 pr-3 text-right font-medium">delivered</th>
              <th className="py-1 pr-3 text-right font-medium">opened</th>
              <th className="py-1 pr-3 text-right font-medium">bounced</th>
              <th className="py-1 pr-3 text-right font-medium">failed</th>
              <th className="py-1 text-right font-medium">skipped</th>
            </tr>
          </thead>
          <tbody>
            {health.byTemplate.map((t) => (
              <tr key={t.template} className="border-b border-zinc-100 last:border-b-0">
                <td className="py-2 pr-3 text-sm text-zinc-700">
                  {t.template}
                  {t.total === 0 && <span className="ml-2 text-xs text-zinc-400">silent</span>}
                </td>
                <td className="py-2 pr-3 text-right text-sm tabular-nums font-medium text-zinc-900">
                  {t.sent}
                </td>
                <td className="py-2 pr-3 text-right text-sm tabular-nums text-zinc-600">
                  {t.delivered}
                </td>
                <td className="py-2 pr-3 text-right text-sm tabular-nums text-zinc-600">
                  {t.opened}
                </td>
                <td
                  className={`py-2 pr-3 text-right text-sm tabular-nums ${t.bounced + t.complained > 0 ? "font-medium text-red-700" : "text-zinc-400"}`}
                >
                  {t.bounced + t.complained}
                </td>
                <td
                  className={`py-2 pr-3 text-right text-sm tabular-nums ${t.failed > 0 ? "font-medium text-red-700" : "text-zinc-400"}`}
                >
                  {t.failed}
                </td>
                <td className="py-2 text-right text-sm tabular-nums text-zinc-500">{t.skipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {health.skipReasons.length > 0 && (
        <section className="rounded-2xl border border-zinc-200 p-5">
          <h2 className="text-sm font-semibold">Why sends were skipped</h2>
          <p className="mb-3 text-xs text-zinc-500">
            A skip is not a failure. Preference, frequency and dedup skips are the system working as
            designed; only the highlighted ones mean something needs attention.
          </p>
          <ul className="flex flex-col gap-1">
            {health.skipReasons.map((s) => (
              <li key={s.reason} className="flex items-baseline justify-between gap-3 text-sm">
                <span
                  className={
                    isBenignSkip(s.reason) ? "text-zinc-600" : "font-medium text-amber-800"
                  }
                >
                  {skipReasonLabel(s.reason)}
                </span>
                <span className="tabular-nums text-zinc-500">{s.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-zinc-200 p-5">
        <h2 className="text-sm font-semibold">Suppressed addresses</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Hard bounces and complaints, all time. These addresses are never mailed again — a climbing
          number here is a deliverability problem, not a code one.
        </p>
        {suppressions.total === 0 ? (
          <p className="text-sm text-zinc-500">None.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {suppressions.byReason.map((s) => (
              <li key={s.reason} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-zinc-600">{s.reason.replace("_", " ")}</span>
                <span className="tabular-nums text-zinc-500">{s.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {truncated && (
        <p className="text-xs text-amber-700">
          Row cap reached — the counts above are a lower bound for this window.
        </p>
      )}
    </main>
  );
}
