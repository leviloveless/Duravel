"use client";

import { useState, useTransition } from "react";
import { setStravaAutopost } from "@/app/settings/connections/actions";

/**
 * Opt-out switch for auto-posting completed workouts to Strava (default ON).
 * Optimistic: flips immediately, reverts if the server action fails. Only
 * rendered when Strava write is enabled + configured (see connections page).
 */
export default function StravaAutopostToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    startTransition(() => {
      setStravaAutopost(next).catch(() => setOn(!next));
    });
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 p-5">
      <div className="flex flex-col">
        <span className="font-medium">Auto-post workouts to Strava</span>
        <span className="text-sm text-zinc-500">
          When Strava is connected, completed sessions post automatically as a branded activity.
          Turn off to keep them off Strava.
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Auto-post workouts to Strava"
        disabled={pending}
        onClick={toggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
          on ? "bg-black" : "bg-zinc-300"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
            on ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
