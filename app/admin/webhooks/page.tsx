import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-access";
import { getWebhooksReport } from "@/lib/admin-ops-data";
import { REQUIRED_STRIPE_EVENTS } from "@/lib/admin-ops";
import { AdminNav, Card, Chip, Eyebrow, Row, fmtDateTime } from "../users/ui";

export const metadata: Metadata = {
  title: "Webhooks · Admin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Webhook health (2026-09-28). Stripe's webhook is the ONLY writer of who has
 * paid, so a broken or half-subscribed endpoint means paying athletes without
 * access. This page asks Stripe directly: is the endpoint there, does it send
 * every event the app needs, has anything failed to deliver, and does the app's
 * `subscriptions` table agree with Stripe. Email webhooks are on /admin/email.
 */
export default async function WebhooksPage() {
  await requireAdmin();
  const r = await getWebhooksReport();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-10">
      <AdminNav current="/admin/webhooks" />
      <div>
        <Eyebrow>Admin / Webhooks</Eyebrow>
        <h1 className="font-display text-ink mt-1 text-3xl font-bold">Webhook health</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Stripe below. Email delivery webhooks (Resend) are on{" "}
          <Link href="/admin/email" className="underline">
            Email health
          </Link>
          .
        </p>
      </div>

      {!r.configured ? (
        <Card title="Stripe isn't configured">
          <p className="text-sm text-zinc-600">STRIPE_SECRET_KEY is not set in this environment.</p>
        </Card>
      ) : r.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          Couldn&apos;t read Stripe: {r.error}
        </div>
      ) : (
        <>
          <Card title="Endpoints">
            {!r.webhookSecretSet ? (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
                STRIPE_WEBHOOK_SECRET is not set: every Stripe event is being rejected.
              </p>
            ) : null}
            {r.endpoints.filter((e) => e.ours).length === 0 ? (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
                No Stripe endpoint points at this site&apos;s /api/stripe/webhook.
              </p>
            ) : null}
            <ul className="flex flex-col gap-3">
              {r.endpoints.map((e) => (
                <li key={e.id} className="rounded-lg border border-zinc-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs break-all text-zinc-800">{e.url}</span>
                    <span className="flex gap-1.5">
                      {e.ours ? <Chip tone="blue">this site</Chip> : null}
                      <Chip tone={e.status === "enabled" ? "green" : "red"}>{e.status}</Chip>
                    </span>
                  </div>
                  {e.ours ? (
                    e.missing.length === 0 ? (
                      <p className="mt-2 text-xs text-emerald-800">
                        Sends every event the app needs.
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-amber-900">
                        Missing: <span className="font-mono">{e.missing.join(", ")}</span>. Add them
                        in Stripe → Developers → Webhooks → this endpoint → Select events.
                      </p>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-zinc-500">
              The app acts on:{" "}
              <span className="font-mono">{REQUIRED_STRIPE_EVENTS.join(", ")}</span>.
            </p>
          </Card>

          <Card title="Delivery">
            <Row label="Most recent Stripe event">
              {r.lastEvent
                ? `${r.lastEvent.type} · ${fmtDateTime(iso(r.lastEvent.createdMs))}`
                : "—"}
            </Row>
            <Row label="Events that failed to deliver (latest 25)">{r.undelivered.length}</Row>
            {r.undelivered.length > 0 ? (
              <ul className="mt-2 flex flex-col divide-y divide-zinc-100 text-xs">
                {r.undelivered.map((ev) => (
                  <li key={ev.id} className="flex justify-between gap-3 py-1.5">
                    <span className="font-mono">{ev.type}</span>
                    <span className="text-zinc-500">
                      {fmtDateTime(iso(ev.createdMs))}
                      {ev.pending > 0 ? ` · ${ev.pending} still retrying` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-xs text-zinc-500">
              Stripe retries a failed delivery for up to three days. To replay one now, open it in
              the Stripe dashboard and choose Resend.
            </p>
          </Card>

          <Card title={`App vs Stripe (latest ${r.checkedSubs} subscriptions)`}>
            {r.drift.length === 0 ? (
              <p className="text-sm text-emerald-800">
                The app&apos;s subscriptions table agrees with Stripe.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-zinc-100 text-sm">
                {r.drift.map((d) => (
                  <li key={d.subscriptionId} className="flex flex-wrap justify-between gap-2 py-2">
                    <span className="font-mono text-xs">{d.subscriptionId}</span>
                    <span className="text-zinc-700">
                      {d.kind === "missing_row"
                        ? `Stripe says ${d.stripeStatus}; the app has no row — this athlete may be paying without access.`
                        : `Stripe says ${d.stripeStatus}; the app says ${d.appStatus}.`}{" "}
                      {d.userId ? (
                        <Link href={`/admin/users/${d.userId}`} className="underline">
                          account
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-zinc-500">
              A mismatch almost always means a missed event. Resending the subscription&apos;s
              latest event from the Stripe dashboard brings the app back in line.
            </p>
          </Card>
        </>
      )}
    </main>
  );
}
