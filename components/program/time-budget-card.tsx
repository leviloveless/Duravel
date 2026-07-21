import type { ProgramData, WeeklyHoursBand } from "@/lib/schemas";
import {
  BUDGET_LABEL,
  BAND_EMPHASIS,
  getBudgetCopy,
  summarizeBudget,
} from "@/lib/time-budget-copy";

/**
 * Program-page card that makes the athlete's weekly-time-budget tradeoff
 * VISIBLE (volume-vs-intensity research): where their budget puts them, the
 * estimated peak volume + load, the intensity mix, and what the budget trades
 * away. Turns the silent band-driven programming into an informed choice.
 *
 * Only rendered when the program was built with a weeklyHours band (legacy
 * programs omit it).
 */

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</span>
      <span className="mt-0.5 text-lg font-semibold tracking-tight text-zinc-900">{value}</span>
      {sub && <span className="text-xs text-zinc-500">{sub}</span>}
    </div>
  );
}

function IntensityBar({ mix }: { mix: { easy: number; threshold: number; hard: number } }) {
  const seg = [
    { label: "Easy", pct: mix.easy, color: "#0f766e" },
    { label: "Threshold", pct: mix.threshold, color: "#ea7317" },
    { label: "Hard", pct: mix.hard, color: "#b91c1c" },
  ];
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full">
        {seg.map((s) => (
          <div key={s.label} style={{ width: `${s.pct}%`, backgroundColor: s.color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        {seg.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label} {s.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

export default function TimeBudgetCard({
  sport,
  band,
  data,
}: {
  sport: string;
  band: WeeklyHoursBand;
  data: ProgramData | null;
}) {
  const copy = getBudgetCopy(sport, band);
  const s = summarizeBudget(data);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Your training-time budget
        </h2>
        <span className="text-sm font-medium text-zinc-500">{BUDGET_LABEL[band]}</span>
      </div>

      <p className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">{copy.level}</p>

      {s && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <Stat
              label="Peak volume"
              value={`${s.peakHours} h/wk`}
              sub={s.peakMiles > 0 ? `~${s.peakMiles} mi run` : undefined}
            />
            <Stat label="Peak load" value={`~${s.peakLoadAu.toLocaleString()}`} sub="session-RPE units" />
            <Stat label="Intensity" value={BAND_EMPHASIS[band]} />
          </div>

          <div className="mt-4">
            <IntensityBar mix={s.mix} />
          </div>
        </>
      )}

      <p className="mt-4 border-t border-zinc-100 pt-4 text-sm text-zinc-600">
        <span className="font-medium text-zinc-800">The tradeoff:</span> {copy.tradeoff}
      </p>

      <p className="mt-2 text-xs text-zinc-400">
        Estimated from your plan. Load is a session-RPE estimate (intensity × time); the intensity
        mix is your program average. Want a different balance? Rebuild with more or fewer weekly
        hours.
      </p>
    </section>
  );
}
