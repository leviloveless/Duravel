import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-access";
import { getRevenueReport } from "@/lib/admin-ops-data";
import { pct } from "@/lib/admin-ops";
import { formatMoney } from "@/lib/admin-account-rules";
import { AdminNav, Card, Eyebrow, Row } from "../users/ui";

export const metadata: Metadata = {
  title: "Revenue · Admin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

function requestNow(): number {
  return Date.now();
}

function Rate({ part, whole }: { part: number; whole: number }) {
  const p = pct(part, whole);
  return <span className="text-zinc-500">{p === null ? "" : ` · ${p}%`}</span>;
}

/**
 * Revenue & conversion (2026-09-28). Read from STRIPE, not from the app's
 * `subscriptions` mirror: the mirror keeps one row per athlete, so it cannot
 * say that someone trialed in August, canceled, and came back in October.
 */
export default async function RevenuePage() {
  await requireAdmin();
  const nowMs = requestNow();
  const report = await getRevenueReport(nowMs);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-10">
      <AdminNav current="/admin/revenue" />
      <div>
        <Eyebrow>Admin / Revenue</Eyebrow>
        <h1 className="font-display text-ink mt-1 text-3xl font-bold">Revenue & conversion</h1>
      </div>

      {!report.configured ? (
        <Card title="Stripe isn't configured">
          <p className="text-sm text-zinc-600">
            STRIPE_SECRET_KEY is not set in this environment, so there is nothing to read.
          </p>
        </Card>
      ) : report.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          Couldn&apos;t read Stripe: {report.error}
        </div>
      ) : (
        <>
          {!report.liveMode ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This environment uses a Stripe TEST key — these are test-mode numbers.
            </div>
          ) : null}
          {report.summary ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Card title="Right now">
                <Row label="Monthly recurring revenue (list price)">
                  {formatMoney(report.summary.mrrMinor, report.summary.currency)}
                </Row>
                <Row label="Paying subscribers">{report.summary.paying}</Row>
                <Row label="— monthly / annual">
                  {report.summary.payingByPlan.monthly} / {report.summary.payingByPlan.annual}
                </Row>
                <Row label="In a free trial (card on file)">{report.summary.inTrial}</Row>
                <Row label="Past due (Stripe retrying the card)">{report.summary.pastDue}</Row>
                <Row label="Churned in the last 30 days">{report.summary.churned30d}</Row>
                <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                  MRR counts annual plans at a twelfth and ignores promo discounts, so it is the
                  list-price run rate, not cash collected.
                </p>
              </Card>
              <Card title="How it's counted">
                <p className="text-sm leading-relaxed text-zinc-600">
                  The funnel follows the accounts created in each window. <b>Built a program</b>{" "}
                  means at least one ready program. <b>Started a trial</b> means a Stripe
                  subscription with a trial. <b>Converted</b> means that subscription carried on
                  past the trial end — it is billing now, or was canceled only after being charged.
                  Canceled during the trial is not a conversion.
                </p>
                {report.capped ? (
                  <p className="mt-2 text-xs text-amber-800">
                    Showing the most recent 3,000 Stripe subscriptions.
                  </p>
                ) : null}
              </Card>
            </div>
          ) : null}

          <Card title="Signup funnel">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Cohort</th>
                    <th className="py-2 pr-3 text-right font-medium">Signed up</th>
                    <th className="py-2 pr-3 text-right font-medium">Built a program</th>
                    <th className="py-2 pr-3 text-right font-medium">Started trial</th>
                    <th className="py-2 pr-3 text-right font-medium">Converted</th>
                    <th className="py-2 text-right font-medium">Still in trial</th>
                  </tr>
                </thead>
                <tbody>
                  {report.funnels.map(({ label, funnel: f }) => (
                    <tr key={label} className="border-t border-zinc-100 tabular-nums">
                      <td className="py-2 pr-3 text-zinc-700">{label}</td>
                      <td className="py-2 pr-3 text-right">{f.signups}</td>
                      <td className="py-2 pr-3 text-right">
                        {f.builtProgram}
                        <Rate part={f.builtProgram} whole={f.signups} />
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {f.startedTrial}
                        <Rate part={f.startedTrial} whole={f.signups} />
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {f.converted}
                        <Rate part={f.converted} whole={f.startedTrial - f.stillInTrial} />
                      </td>
                      <td className="py-2 text-right">{f.stillInTrial}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Conversion % is of trials that have finished (still-running trials are left out).
            </p>
          </Card>

          <Card title="By week (UTC, Monday start)">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Week of</th>
                    <th className="py-2 pr-3 text-right font-medium">Signups</th>
                    <th className="py-2 pr-3 text-right font-medium">Trials started</th>
                    <th className="py-2 text-right font-medium">Trials converted</th>
                  </tr>
                </thead>
                <tbody>
                  {report.weeks.map((w) => (
                    <tr key={w.weekStartMs} className="border-t border-zinc-100 tabular-nums">
                      <td className="py-2 pr-3 text-zinc-700">
                        {new Date(w.weekStartMs).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        })}
                      </td>
                      <td className="py-2 pr-3 text-right">{w.signups}</td>
                      <td className="py-2 pr-3 text-right">{w.trials}</td>
                      <td className="py-2 text-right">{w.conversions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}
