import type { Reforecast } from "@/lib/engine/reforecast";

/**
 * Projected-times card (#17 projection + §4 re-forecast). Before the program
 * starts it shows the build-time projection (imported → target). Once training is
 * logged it shows the live re-forecast: imported → now → end-of-program target,
 * driven by real adherence and any fresh measurements. Read-only.
 */
export default function ProjectionCard({ reforecast }: { reforecast: Reforecast }) {
  const { perEvent, finishBaseline, finishNow, finishEnd, weekK, weeksW, adherencePct, onTrack, note } =
    reforecast;
  const inProgress = weekK > 0;
  const hasFinish = !!finishBaseline && !!finishEnd;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Projected times</h2>
        {hasFinish && (
          <p className="text-sm text-zinc-600">
            Finish <span className="text-zinc-400 line-through tabular-nums">{finishBaseline}</span>{" "}
            {inProgress && finishNow && <span className="tabular-nums text-zinc-500">{finishNow} →</span>}{" "}
            <span className="font-semibold tabular-nums text-emerald-700">{finishEnd}</span>
          </p>
        )}
      </div>

      <p className="mt-1 text-sm text-zinc-600">
        {inProgress
          ? `Week ${weekK} of ${weeksW} · ${adherencePct}% of sessions logged. Your end-of-program projection, updated from your training so far.`
          : "Where your most recent result should land by the end of this program — scaled by its length, your experience, and each event's room to improve."}
      </p>

      {perEvent.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {perEvent.map((e) => (
            <li key={e.key} className="flex items-baseline justify-between gap-2">
              <span className="text-zinc-600">
                {e.label}
                {e.measured && (
                  <span className="ml-1 text-[10px] font-medium uppercase text-sky-600">measured</span>
                )}
              </span>
              <span className="tabular-nums">
                <span className="text-zinc-400 line-through">{e.baseline}</span>{" "}
                {inProgress && <span className="text-zinc-500">{e.now} →</span>}{" "}
                <span className="font-medium text-zinc-900">{e.end}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {inProgress && (
        <p className={`mt-3 text-xs ${onTrack ? "text-emerald-700" : "text-amber-700"}`}>
          {onTrack ? "On track for your projected finish." : "Behind the original target."}
        </p>
      )}
      {note && <p className="mt-2 text-xs text-amber-700">{note}</p>}

      <p className="mt-3 text-xs text-zinc-400">
        Estimates anchored to public HYROX benchmarks — a realistic target, not a guarantee.
      </p>
    </section>
  );
}
