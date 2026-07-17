"use client";

import { useState } from "react";
import { usePostAction } from "@/lib/hooks/use-post-action";
import { Button } from "@/components/ui/button";

/**
 * Daily resting HR + HRV entry (Tasks addition #7). Defaults to today; the
 * athlete can back-date. Averages roll up into the weekly summary table's
 * "Recovery avg" columns.
 */
export default function DailyMetricsForm({ today }: { today: string }) {
  const { run, pending, error } = usePostAction("/api/daily-metrics");
  const [date, setDate] = useState(today);
  const [restingHr, setRestingHr] = useState("");
  const [hrv, setHrv] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    const body: Record<string, unknown> = { date };
    if (restingHr.trim()) body.restingHr = Number(restingHr);
    if (hrv.trim()) body.hrv = Number(hrv);
    const r = await run(body);
    if (r?.ok) {
      setSaved(true);
      setRestingHr("");
      setHrv("");
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Daily resting HR &amp; HRV</h2>
        <span className="text-xs text-zinc-400">Log on waking · weekly averages show in the summary</span>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Date
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => {
              setDate(e.target.value);
              setSaved(false);
            }}
            className="rounded-md border border-zinc-300 px-2 py-1 focus:border-black focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Resting HR
          <input
            type="number"
            min={25}
            max={150}
            value={restingHr}
            onChange={(e) => {
              setRestingHr(e.target.value);
              setSaved(false);
            }}
            placeholder="bpm"
            className="w-28 rounded-md border border-zinc-300 px-2 py-1 focus:border-black focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          HRV
          <input
            type="number"
            min={1}
            max={400}
            value={hrv}
            onChange={(e) => {
              setHrv(e.target.value);
              setSaved(false);
            }}
            placeholder="ms"
            className="w-28 rounded-md border border-zinc-300 px-2 py-1 focus:border-black focus:outline-none"
          />
        </label>
        <Button variant="primary" size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved && !error && <span className="text-sm text-green-600">Saved</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </section>
  );
}
