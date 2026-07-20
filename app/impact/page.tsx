import { getFundraiser } from "@/lib/fundraiser-data";
import { formatUsd, progressPct, remainingCents } from "@/lib/fundraiser";

/**
 * Public Race for Impact tracker (#19) — a shareable progress page for Levi's
 * Instagram bio: how much has been raised toward the goal, with a donate button.
 * No auth; reads the single fundraiser row (public RLS).
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Race for Impact · Duravel",
  description: "Follow the fundraiser — how much we've raised toward the goal.",
};

export default async function ImpactPage() {
  const f = await getFundraiser();

  if (!f || f.goal_cents <= 0) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">Race for Impact</h1>
        <p className="text-zinc-500">The fundraiser is being set up — check back soon.</p>
      </main>
    );
  }

  const pct = progressPct(f.raised_cents, f.goal_cents);
  const remaining = remainingCents(f.raised_cents, f.goal_cents);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16 text-center">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{f.title}</h1>
        {f.tagline && <p className="text-zinc-600">{f.tagline}</p>}
      </header>

      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-6">
        <div className="flex items-end justify-between">
          <div className="text-left">
            <div className="text-3xl font-bold text-zinc-900">{formatUsd(f.raised_cents)}</div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">raised</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold text-zinc-600">{formatUsd(f.goal_cents)}</div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">goal</div>
          </div>
        </div>

        <div className="h-4 w-full overflow-hidden rounded-full bg-zinc-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-lime-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-zinc-500">
          {pct}% there · {formatUsd(remaining)} to go
        </p>

        {f.donate_url && (
          <a
            href={f.donate_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            Donate
          </a>
        )}
      </div>

      <p className="text-xs text-zinc-400">Updated {new Date(f.updated_at).toLocaleDateString()}</p>
    </main>
  );
}
