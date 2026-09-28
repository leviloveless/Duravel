"use client";

import { useState, useTransition } from "react";
import { submitWaitlist } from "@/app/coaching/actions";
import { Button } from "@/components/ui/button";

/**
 * Focused coaching-waitlist intake (#16). No payment — an application. Prefills
 * name/email when signed in. On success shows a confirmation instead of the form.
 */
export default function WaitlistForm({
  defaultName = "",
  defaultEmail = "",
}: {
  defaultName?: string;
  defaultEmail?: string;
}) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [sportGoal, setSportGoal] = useState("");
  const [currentTraining, setCurrentTraining] = useState("");
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const r = await submitWaitlist({ name, email, sportGoal, currentTraining, why });
      if (r.ok) setDone(true);
      else setError(r.error);
    });
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-2xl">✅</p>
        <h3 className="mt-2 text-lg font-semibold text-emerald-900">You&apos;re on the list</h3>
        <p className="mt-1 text-sm text-emerald-800">
          Thanks — I review every application personally and will reach out by email if it&apos;s a
          fit.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </Field>
      </div>
      <Field label="Sport & goal">
        <input
          value={sportGoal}
          onChange={(e) => setSportGoal(e.target.value)}
          placeholder="e.g. HYROX sub-70, first Ironman 70.3, DEKA PR"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </Field>
      <Field label="How you train now">
        <textarea
          value={currentTraining}
          onChange={(e) => setCurrentTraining(e.target.value)}
          rows={2}
          placeholder="Days/week, current volume, recent races or times…"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Why 1-on-1 coaching?">
        <textarea
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          rows={2}
          placeholder="What you're looking for from a coach."
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button variant="primary" onClick={submit} disabled={pending} className="w-full">
        {pending ? "Submitting…" : "Apply for coaching"}
      </Button>
      <p className="text-center text-xs text-zinc-400">
        No payment now — this is an application. I approve clients personally.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}
