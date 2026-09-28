import Link from "next/link";
import { adminGateMiss, getAdmin } from "@/lib/admin";
import { getGenerationCostRollup } from "@/lib/admin-metrics";
import type { Bucket, CostStats } from "@/lib/generation-cost";

/**
 * Admin generation-cost analytics (#14) — average program generation +
 * recalculation token cost, and how it correlates with program type, length,
 * race count, and the amount of data the athlete entered.
 */
export const dynamic = "force-dynamic";

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function StatRow({ label, stats }: { label: string; stats: CostStats }) {
  return (
    <tr className="border-b border-zinc-100 last:border-b-0">
      <td className="py-2 pr-3 text-sm text-zinc-700">{label}</td>
      <td className="py-2 pr-3 text-right text-sm tabular-nums text-zinc-600">{stats.count}</td>
      <td className="py-2 pr-3 text-right text-sm tabular-nums font-medium text-zinc-900">
        {usd(stats.avgCostUsd)}
      </td>
      <td className="py-2 pr-3 text-right text-sm tabular-nums text-zinc-600">
        {stats.avgInputTokens.toLocaleString()}
      </td>
      <td className="py-2 pr-3 text-right text-sm tabular-nums text-zinc-600">
        {stats.avgOutputTokens.toLocaleString()}
      </td>
      <td className="py-2 text-right text-sm tabular-nums text-zinc-600">
        {usd(stats.totalCostUsd)}
      </td>
    </tr>
  );
}

function Table({ title, rows }: { title: string; rows: Bucket[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-2xl border border-zinc-200 p-5">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-400">
            <th className="py-1 pr-3 font-medium"></th>
            <th className="py-1 pr-3 text-right font-medium">n</th>
            <th className="py-1 pr-3 text-right font-medium">avg cost</th>
            <th className="py-1 pr-3 text-right font-medium">avg in tok</th>
            <th className="py-1 pr-3 text-right font-medium">avg out tok</th>
            <th className="py-1 text-right font-medium">total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <StatRow key={b.key} label={b.key} stats={b.stats} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function AdminMetricsPage() {
  const admin = await getAdmin();
  if (!admin) return adminGateMiss();

  const r = await getGenerationCostRollup();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="flex flex-col gap-1">
        <Link href="/admin" className="text-sm text-zinc-500 underline">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold">Generation cost</h1>
        <p className="text-sm text-zinc-500">
          Average token cost per program generation & recalculation, from stamped usage.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Runs w/ usage" value={String(r.overall.count)} />
        <Stat label="Avg cost / run" value={usd(r.overall.avgCostUsd)} />
        <Stat label="Avg output tok" value={r.overall.avgOutputTokens.toLocaleString()} />
        <Stat label="Total cost" value={usd(r.overall.totalCostUsd)} />
      </section>

      {r.overall.count === 0 ? (
        <p className="text-sm text-zinc-500">
          No generation runs with stamped usage yet. Costs appear here once programs are generated.
        </p>
      ) : (
        <>
          <Table title="By kind (create vs recalculate)" rows={r.byKind} />
          <Table title="By program type" rows={r.byProgramType} />
          <Table title="By program length" rows={r.byDurationBucket} />
          <Table title="By race count" rows={r.byRaceCount} />
          <Table title="By input-data volume" rows={r.byInputSizeBucket} />
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4">
      <div className="text-lg font-semibold tabular-nums text-zinc-900">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}
