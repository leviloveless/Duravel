/**
 * Athlete-facing coaching notes (#15/#16) — notes a coach left on this program,
 * shown read-only to the athlete. Rendered only when there are notes.
 */
import { formatInstant } from "@/lib/timezone";

export type CoachNote = { id: string; body: string; created_at: string };

export default function CoachingNotesView({
  notes,
  timeZone,
}: {
  notes: CoachNote[];
  /** Athlete's IANA zone — see `formatInstant`. `created_at` is an INSTANT, so
   *  formatting it with the ambient zone desyncs server and client hydration. */
  timeZone?: string | null;
}) {
  if (notes.length === 0) return null;
  return (
    <section className="rounded-2xl border border-lime-300 bg-lime-50 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
        <span aria-hidden>📝</span> Notes from your coach
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg bg-white/70 px-3 py-2">
            <p className="whitespace-pre-wrap text-sm text-zinc-700">{n.body}</p>
            <p className="mt-1 text-[11px] text-zinc-400">{formatInstant(n.created_at, timeZone, { month: "short", day: "numeric", year: "numeric" }, "")}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
