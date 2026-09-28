"use client";

import { useActionState } from "react";
import { joinIosWaitlist, type WaitlistState } from "./actions";

export default function WaitlistForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, action, pending] = useActionState<WaitlistState, FormData>(joinIosWaitlist, {
    status: "idle",
    message: "",
  });
  if (state.status === "ok") {
    return (
      <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="ios-email" className="text-xs font-semibold text-zinc-700">
        Email me when the iPhone beta opens
      </label>
      <div className="flex gap-2">
        <input
          id="ios-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={defaultEmail}
          placeholder="you@example.com"
          className="border-line-strong focus:border-accent flex-1 rounded-md border px-3 py-2.5 text-sm focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="bg-accent hover:bg-accent-hi rounded-md px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "…" : "Notify me"}
        </button>
      </div>
      {/* Honeypot — hidden from people, filled by bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      ) : (
        <p className="text-[11px] text-zinc-500">
          One email when the beta opens. Nothing else, and you can reply to be removed.
        </p>
      )}
    </form>
  );
}
