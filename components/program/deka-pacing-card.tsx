import { formatDuration, type DekaPacingPlan } from "@/lib/engine/deka-pacing";

/** DEKA race pacing plan: target run split (run formats) + per-zone targets. */
export default function DekaPacingCard({ plan, sportLabel }: { plan: DekaPacingPlan; sportLabel: string }) {
  const isGoal = plan.source === "goal";
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{sportLabel} pacing plan</h2>
        <p className="text-sm text-zinc-600">
          {isGoal ? "Goal" : "Predicted"} finish{" "}
          <span className="font-semibold text-zinc-900">{formatDuration(plan.targetFinishSec)}</span>
          {isGoal && (
            <span className="text-zinc-400"> · predicted {formatDuration(plan.predictedFinishSec)}</span>
          )}
        </p>
      </div>

      <p className="mt-1 text-sm text-zinc-600">
        {plan.hasRunning && (
          <>
            Target run split{" "}
            <span className="font-medium text-zinc-900">{formatDuration(plan.runSplitSecPerKm)}/km</span>{" "}
            · {(plan.totalRunMeters / 1000).toLocaleString()} km running {formatDuration(plan.runTotalSec)} ·{" "}
          </>
        )}
        10 zones {formatDuration(plan.zonesTotalSec)} · transitions {formatDuration(plan.transitionSec)}
        {plan.laps > 1 && <span className="text-zinc-400"> · {plan.laps} laps</span>}
      </p>

      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        {plan.zones.map((z, i) => (
          <li key={z.id} className="flex justify-between gap-2">
            <span className="text-zinc-600">
              <span className="text-zinc-400">{i + 1}.</span> {z.label}
            </span>
            <span className="font-medium tabular-nums">{formatDuration(z.targetSec)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-zinc-400">
        Even-split targets{plan.laps > 1 ? " per lap" : ""} — hold these rather than redlining early.
        {plan.hasRunning && " Zone times and run split are individualized from your run and erg benchmarks where available."}
        {!plan.hasRunning && " Zone times are individualized from your erg benchmarks where available."}
      </p>
    </section>
  );
}
