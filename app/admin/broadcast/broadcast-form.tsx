"use client";

import { useActionState } from "react";
import { sendBroadcast, type BroadcastState, type BroadcastValues } from "./actions";

const input =
  "w-full rounded-md border border-line-strong bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
const label = "mb-1 block text-xs font-medium text-zinc-600";

/**
 * Compose + send. Everything is re-rendered from the action's returned state, so
 * the text survives a failed check or a test send.
 */
export default function BroadcastForm({
  broadcastId,
  initial,
  segments,
  locked,
}: {
  broadcastId: string;
  initial: BroadcastValues;
  segments: { key: string; label: string; count: number }[];
  locked: boolean;
}) {
  const [state, action, pending] = useActionState<BroadcastState, FormData>(sendBroadcast, {
    status: "idle",
    message: "",
    broadcastId,
    values: initial,
  });
  const v = state.values;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="broadcastId" value={state.broadcastId} />
      {state.status !== "idle" ? (
        <div
          role={state.status === "error" ? "alert" : "status"}
          className={`rounded-lg border px-4 py-3 text-sm ${
            state.status === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {state.message}
        </div>
      ) : null}
      <div>
        <label htmlFor="b-segment" className={label}>
          Who it goes to
        </label>
        <select id="b-segment" name="segment" defaultValue={v.segment} className={input}>
          {segments.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label} — {s.count}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500">
          Counts are accounts with a confirmed email. Anyone who has unsubscribed, turned off
          product updates, or already had a Duravel email today is skipped when it sends.
        </p>
      </div>
      <div>
        <label htmlFor="b-subject" className={label}>
          Subject
        </label>
        <input
          id="b-subject"
          name="subject"
          defaultValue={v.subject}
          maxLength={120}
          className={input}
        />
      </div>
      <div>
        <label htmlFor="b-body" className={label}>
          Message (plain text; a blank line starts a new paragraph; &ldquo;Hi first-name,&rdquo; is
          added for you)
        </label>
        <textarea id="b-body" name="body" rows={10} defaultValue={v.body} className={input} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="b-bl" className={label}>
            Button label (optional)
          </label>
          <input id="b-bl" name="buttonLabel" defaultValue={v.buttonLabel} className={input} />
        </div>
        <div>
          <label htmlFor="b-bu" className={label}>
            Button link (https://… or /path)
          </label>
          <input id="b-bu" name="buttonUrl" defaultValue={v.buttonUrl} className={input} />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-4">
        <button
          type="submit"
          name="mode"
          value="test"
          disabled={locked || pending}
          className="border-line-strong rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
        >
          Send a test to me
        </button>
        <div className="flex items-end gap-2">
          <div>
            <label htmlFor="b-confirm" className={label}>
              Type the recipient count to send
            </label>
            <input id="b-confirm" name="confirm" autoComplete="off" className={`${input} w-28`} />
          </div>
          <button
            type="submit"
            name="mode"
            value="send"
            disabled={locked || pending}
            className="bg-ink rounded-md px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {pending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
      {pending ? (
        <p className="text-xs text-zinc-500">
          Sending about two a second — a full batch of 250 takes a couple of minutes. Keep this tab
          open.
        </p>
      ) : null}
    </form>
  );
}
