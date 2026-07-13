import { formatDuration, type PacingPlan } from "@/lib/engine/pacing";

/** Race pacing plan (Review #6): target 1 km run split + per-station targets. */
export default function PacingCard({ plan }: { plan: PacingPlan }) {
  const isGoal = plan.source === "goal";
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Race pacing plan</h2>
        <p className="text-sm text-zinc-600">
          {isGoal ? "Goal" : "Predicted"} finish{" "}
          <span className="font-semibold text-zinc-900">{formatDuration(plan.targetFinishSec)}</span>
          {isGoal && (
            <span className="text-zinc-400"> · predicted {formatDuration(plan.predictedFinishSec)}</span>
          )}
        </p>
      </div>

      <p className="mt-1 text-sm text-zinc-600">
        Target run split{" "}
        <span className="font-medium text-zinc-900">{formatDuration(plan.runSplitSecPerKm)}/km</span>{" "}
        · 8 runs {formatDuration(plan.runTotalSec)} · transitions {formatDuration(plan.roxzoneSec)}
      </p>

      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        {plan.stations.map((s) => (
          <li key={s.id} className="flex justify-between gap-2">
            <span className="text-zinc-600">{s.label}</span>
            <span className="font-medium tabular-nums">{formatDuration(s.targetSec)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-zinc-400">
        Even-split targets — hold these rather than redlining early (especially the sled). Stations use
        your division and are individualized from your run and erg benchmarks where available.
      </p>
    </section>
  );
}
