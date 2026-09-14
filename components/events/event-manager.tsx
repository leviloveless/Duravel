"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createEvent, deleteEvent, updateEvent, type EventState } from "@/app/events/actions";
import {
  PRIORITY_BLURB,
  PRIORITY_LABEL,
  eventTitle,
  type EventRow,
  type RacePriority,
} from "@/lib/events/derive";

const initial: EventState = { error: null, ok: false };
const FIELD =
  "rounded-md border border-line-strong px-3 py-2 text-sm focus:border-accent focus:outline-none";
const LABEL = "text-xs font-semibold text-zinc-700";

const PRIORITY_STYLE: Record<RacePriority, string> = {
  A: "bg-accent-wash text-accent",
  B: "bg-zinc-100 text-zinc-700",
  C: "bg-zinc-50 text-zinc-500",
};

function EventForm({ event, onDone }: { event?: EventRow; onDone?: () => void }) {
  const action = event ? updateEvent.bind(null, event.id) : createEvent;
  const [state, formAction, pending] = useActionState(action, initial);

  if (state.ok && onDone) onDone();

  return (
    <form action={formAction} className="border-line flex flex-col gap-3 rounded-xl border p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className={LABEL} htmlFor={`n-${event?.id ?? "new"}`}>
            Name
          </label>
          <input
            id={`n-${event?.id ?? "new"}`}
            name="name"
            defaultValue={event?.name ?? ""}
            placeholder="HYROX Dallas"
            className={FIELD}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL} htmlFor={`d-${event?.id ?? "new"}`}>
            Date
          </label>
          <input
            id={`d-${event?.id ?? "new"}`}
            name="raceDate"
            type="date"
            required
            defaultValue={event?.race_date ?? ""}
            className={`${FIELD} font-mono`}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL} htmlFor={`p-${event?.id ?? "new"}`}>
            Priority
          </label>
          <select
            id={`p-${event?.id ?? "new"}`}
            name="priority"
            defaultValue={event?.priority ?? "A"}
            className={FIELD}
          >
            {(["A", "B", "C"] as const).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]} — {PRIORITY_BLURB[p]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL} htmlFor={`s-${event?.id ?? "new"}`}>
            Sport
          </label>
          <input
            id={`s-${event?.id ?? "new"}`}
            name="sport"
            defaultValue={event?.sport ?? ""}
            placeholder="HYROX"
            className={FIELD}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL} htmlFor={`g-${event?.id ?? "new"}`}>
            Goal time
          </label>
          <input
            id={`g-${event?.id ?? "new"}`}
            name="goalTime"
            defaultValue={event?.goal_time ?? ""}
            placeholder="1:12:00"
            className={`${FIELD} font-mono`}
          />
        </div>
      </div>

      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="bg-accent hover:bg-accent-hi rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : event ? "Save changes" : "Add race"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="text-sm text-zinc-500 hover:text-black">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default function EventManager({ events }: { events: readonly EventRow[] }) {
  const [adding, setAdding] = useState(events.length === 0);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {adding ? (
        <EventForm onDone={() => setAdding(false)} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="border-line-strong hover:border-accent self-start rounded-md border px-4 py-2 text-sm font-semibold"
        >
          Add a race
        </button>
      )}

      {events.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No races yet. Add one and the dashboard starts counting down to it — you do not need a
          program for it to count.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((e) =>
            editing === e.id ? (
              <li key={e.id}>
                <EventForm event={e} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li
                key={e.id}
                className="border-line flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-white p-4"
              >
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${PRIORITY_STYLE[e.priority]}`}
                >
                  {e.priority}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{eventTitle(e)}</span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {e.race_date}
                    {e.goal_time ? ` · goal ${e.goal_time}` : ""}
                    {e.program_id ? " · program built" : ""}
                  </span>
                </span>

                <span className="ml-auto flex items-center gap-2">
                  {!e.program_id && (
                    <Link
                      href={`/onboarding?eventId=${e.id}`}
                      className="border-line-strong rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-zinc-50"
                    >
                      Build a program
                    </Link>
                  )}
                  {e.source === "athlete" ? (
                    <>
                      <button
                        onClick={() => setEditing(e.id)}
                        className="text-xs text-zinc-500 underline hover:text-black"
                      >
                        Edit
                      </button>
                      <form action={deleteEvent.bind(null, e.id)}>
                        <button type="submit" className="text-xs text-red-600 underline">
                          Delete
                        </button>
                      </form>
                    </>
                  ) : (
                    // Rows the generator wrote belong to their program. Editing
                    // them here would leave the block and the race disagreeing
                    // with no way to reconcile — the program builder owns them.
                    <span
                      className="text-[11px] text-zinc-400"
                      title="Written when you built this program — edit it by recalculating that program"
                    >
                      From a program
                    </span>
                  )}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
