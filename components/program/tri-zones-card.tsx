import type { TriZones, ZoneRow } from "@/lib/engine/tri-zones";

function ZoneTable({ title, anchor, rows }: { title: string; anchor: string; rows: ZoneRow[] }) {
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
            <span className="font-medium tabular-nums text-zinc-900">{r.range}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Per-discipline training zones for triathlon. Shows only the disciplines the
 * athlete supplied an anchor for (CSS / FTP / a run time), with a nudge for any
 * missing anchor so they know how to unlock it.
 */
export default function TriZonesCard({ zones }: { zones: TriZones }) {
  const any = zones.swim || zones.bike || zones.run;

  const missing: string[] = [];
  if (!zones.swim) missing.push("swim CSS pace");
  if (!zones.bike) missing.push("bike FTP");
  if (!zones.run) missing.push("a run time (mile / 5K / 10K)");

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Training zones by discipline</h2>
      {!any && (
        <p className="mt-1 text-sm text-zinc-600">
          Add your swim CSS pace, bike FTP, and a run time in your profile to get personalized pace and
          power zones for each discipline.
        </p>
      )}
      {any && (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {zones.swim && (
              <ZoneTable title="Swim" anchor={`CSS ${zones.swim.cssPer100}/100m`} rows={zones.swim.zones} />
            )}
            {zones.bike && (
              <ZoneTable title="Bike" anchor={`FTP ${zones.bike.ftpWatts}W`} rows={zones.bike.zones} />
            )}
            {zones.run && (
              <ZoneTable title="Run" anchor={`VDOT ${zones.run.vdot}`} rows={zones.run.zones} />
            )}
          </div>
          {missing.length > 0 && (
            <p className="mt-3 text-xs text-zinc-400">
              Add {missing.join(", ")} in your profile to unlock the remaining discipline
              {missing.length > 1 ? "s" : ""}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
