import Link from "next/link";
import {
  PRIORITY_LABEL,
  closeARaces,
  countdownTo,
  dateDrift,
  eventTitle,
  upcoming,
  type EventRow,
} from "@/lib/events/derive";

/**
 * The Events card (2026-09-14).
 *
 * Two things here are more than a list. The **close A races** warning says what
 * a coach would: you cannot peak twice inside eight weeks, so decide now which
 * one is the real target. And the **date drift** notice surfaces the one state
 * this design deliberately allows — an event and the block built for it
 * disagreeing — because the alternative was silently rewriting a periodized
 * plan behind the athlete's back.
 */
export default function EventsCard({
  events,
  today,
  programDateFor,
}: {
  events: readonly EventRow[];
  today: string;
  /** The date a program was actually periodized for, or null if unknown. */
  programDateFor: (programId: string) => string | null;
}) {
  const ahead = upcoming(events, today).slice(0, 5);
  const warnings = closeARaces(events, today);
  const drift = dateDrift(upcoming(events, today), programDateFor);

  if (ahead.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No races on the calendar.{" "}
        <Link href="/events" className="text-accent underline">
          Add one
        </Link>{" "}
        and the countdown starts — you do not need a program for it to count.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col">
        {ahead.map((e) => {
          const c = countdownTo(e);
          return (
            <div
              key={e.id}
              className="border-line flex items-center gap-3 border-b py-2.5 last:border-b-0"
            >
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  e.priority === "A" ? "bg-accent-wash text-accent" : "bg-zinc-100 text-zinc-600"
                }`}
                title={PRIORITY_LABEL[e.priority]}
              >
                {e.priority}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13.5px] font-medium">{eventTitle(e)}</span>
                <span className="font-mono text-[11px] text-zinc-500">
                  {e.race_date}
                  {e.goal_time ? ` · goal ${e.goal_time}` : ""}
                </span>
              </span>
              <span className="ml-auto shrink-0 text-right">
                <span className="block font-mono text-[13px] font-semibold">
                  {c?.days ?? "—"} d
                </span>
                {c && c.weeks > 0 && (
                  <span className="block font-mono text-[11px] text-zinc-500">
                    {c.weeks}w {c.spareDays}d
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {warnings.map((w) => (
        <p
          key={`${w.first.id}-${w.second.id}`}
          className="rounded-lg bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-zinc-700"
        >
          <b>{eventTitle(w.first)}</b> and <b>{eventTitle(w.second)}</b> are{" "}
          <b>{w.weeksApart} weeks</b> apart. You cannot properly peak for both — a taper and the
          rebuild behind it need longer than that. Pick the one that matters and race the other one
          through.
        </p>
      ))}

      {drift.map((d) => (
        <p
          key={d.event.id}
          className="rounded-lg bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-zinc-700"
        >
          <b>{eventTitle(d.event)}</b> is dated{" "}
          <span className="font-mono">{d.event.race_date}</span>, but the block built for it was
          periodized for <span className="font-mono">{d.programDate}</span> —{" "}
          {Math.abs(d.daysApart)} days {d.daysApart > 0 ? "earlier" : "later"}. Nothing was changed
          automatically: the taper was computed against that date.{" "}
          <Link href={`/program/${d.event.program_id}/edit`} className="text-accent underline">
            Recalculate the block
          </Link>{" "}
          if the race moved.
        </p>
      ))}

      <Link href="/events" className="text-accent self-start text-xs font-semibold underline">
        Manage races
      </Link>
    </div>
  );
}
