import type { TriZones, ZoneRow } from "@/lib/engine/tri-zones";

function ZoneTable({
  title,
  anchor,
  rows,
  note,
  showHr,
}: {
  title: string;
  anchor: string;
  rows: ZoneRow[];
  note?: string;
  showHr?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-zinc-500">{anchor}</span>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.zone} className="flex items-baseline justify-between gap-2">
            <span className="text-zinc-600">
              <span className="mr-1 font-medium text-zinc-400">{r.zone}</span>
              {r.label}
            </span>
            <span className="text-right">
              <span className="font-medium tabular-nums text-zinc-900">{r.range}</span>
              {showHr && r.hr && (
                <span className="block text-[11px] font-normal tabular-nums text-zinc-400">{r.hr}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-[11px] text-zinc-400">{note}</p>}
    </div>
  );
}

/**
 * Per-discipline training zones for triathlon. Swim and bike are always shown
 * (with % of FTP / effort-based ranges when the athlete hasn't entered CSS / FTP
 * yet); the run table appears once a run benchmark yields a VDOT. Bike zones
 * carry a secondary heart-rate target (% of LTHR) beneath each power band.
 */
export default function TriZonesCard({ zones }: { zones: TriZones }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Training zones by discipline</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Bike is paced off power (watts / % FTP) with heart rate as a secondary monitor. Swim is paced off CSS,
        run off your VDOT threshold.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {zones.swim && (
          <ZoneTable
            title="Swim"
            anchor={zones.swim.cssPer100 ? `CSS ${zones.swim.cssPer100}/100m` : "by effort"}
            rows={zones.swim.zones}
            note={zones.swim.note}
          />
        )}
        {zones.bike && (
          <ZoneTable
            title="Bike"
            anchor={zones.bike.ftpWatts ? `FTP ${zones.bike.ftpWatts}W` : "% of FTP"}
            rows={zones.bike.zones}
            note={zones.bike.note}
            showHr
          />
        )}
        {zones.run && (
          <ZoneTable title="Run" anchor={`VDOT ${zones.run.vdot}`} rows={zones.run.zones} />
        )}
      </div>
    </section>
  );
}
