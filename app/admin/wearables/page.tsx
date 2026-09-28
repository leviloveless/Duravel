import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-access";
import { getWearablesReport } from "@/lib/admin-ops-data";
import { AdminNav, Card, Chip, Eyebrow, fmtDateTime } from "../users/ui";

export const metadata: Metadata = {
  title: "Wearables · Admin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  strava: "Strava",
  garmin: "Garmin",
  oura: "Oura",
  whoop: "WHOOP",
  apple_health: "Apple Health",
};

function requestNow(): number {
  return Date.now();
}

/** Wearable connections (2026-09-28): who is connected, and whose sync has gone quiet. */
export default async function WearablesPage() {
  await requireAdmin();
  const report = await getWearablesReport(requestNow());

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-10">
      <AdminNav current="/admin/wearables" />
      <div>
        <Eyebrow>Admin / Wearables</Eyebrow>
        <h1 className="font-display text-ink mt-1 text-3xl font-bold">Wearable connections</h1>
      </div>

      <Card title="Integrations configured in this environment">
        <div className="flex flex-wrap gap-2">
          {report.configured.map((c) => (
            <Chip key={c.provider} tone={c.on ? "green" : "zinc"}>
              {LABEL[c.provider] ?? c.provider} · {c.on ? "on" : "not configured"}
            </Chip>
          ))}
        </div>
      </Card>

      {report.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {report.error}
        </div>
      ) : (
        <>
          <Card title="By provider">
            {report.providers.length === 0 ? (
              <p className="text-sm text-zinc-500">No connections yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Provider</th>
                      <th className="py-2 pr-3 text-right font-medium">Connected</th>
                      <th className="py-2 pr-3 text-right font-medium">Synced 24h</th>
                      <th className="py-2 pr-3 text-right font-medium">Synced 7d</th>
                      <th className="py-2 pr-3 text-right font-medium">Quiet &gt; 7d</th>
                      <th className="py-2 pr-3 text-right font-medium">Activities 7d</th>
                      <th className="py-2 text-right font-medium">Activities 30d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.providers.map((p) => (
                      <tr key={p.provider} className="border-t border-zinc-100 tabular-nums">
                        <td className="py-2 pr-3 text-zinc-800">
                          {LABEL[p.provider] ?? p.provider}
                        </td>
                        <td className="py-2 pr-3 text-right">{p.connected}</td>
                        <td className="py-2 pr-3 text-right">{p.synced24h}</td>
                        <td className="py-2 pr-3 text-right">{p.synced7d}</td>
                        <td
                          className={`py-2 pr-3 text-right ${p.stale > 0 ? "font-medium text-amber-800" : ""}`}
                        >
                          {p.stale}
                        </td>
                        <td className="py-2 pr-3 text-right">{p.activities7d}</td>
                        <td className="py-2 text-right">{p.activities30d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-zinc-500">
              Apple Health pushes from the phone rather than being pulled, so a quiet Apple Health
              connection usually means the app hasn&apos;t been opened, not that anything is broken.
            </p>
          </Card>

          <Card title={`Quiet connections (${report.stale.length})`}>
            {report.stale.length === 0 ? (
              <p className="text-sm text-zinc-500">Every connection has synced in the last week.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-zinc-100 text-sm">
                {report.stale.slice(0, 200).map((s) => (
                  <li
                    key={`${s.userId}:${s.provider}`}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <Link href={`/admin/users/${s.userId}`} className="text-zinc-900 underline">
                      {s.email ?? s.userId}
                    </Link>
                    <span className="text-zinc-500">
                      {LABEL[s.provider] ?? s.provider} · last sync{" "}
                      {s.lastSyncMs ? fmtDateTime(new Date(s.lastSyncMs).toISOString()) : "never"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
