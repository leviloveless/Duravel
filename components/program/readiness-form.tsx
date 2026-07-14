"use client";

import { useEffect, useState } from "react";
import type { ReadinessCheckinRow } from "@/lib/supabase/queries";
import { usePostAction } from "@/lib/hooks/use-post-action";
import { Button } from "@/components/ui/button";

const ITEMS: { key: "sleep" | "fatigue" | "stress" | "soreness"; label: string; low: string; high: string }[] = [
  { key: "sleep", label: "Sleep", low: "great", high: "terrible" },
  { key: "fatigue", label: "Fatigue", low: "fresh", high: "exhausted" },
  { key: "stress", label: "Stress", low: "calm", high: "very high" },
  { key: "soreness", label: "Soreness", low: "none", high: "very sore" },
];

export default function ReadinessForm({
  programId,
  weekNumber,
  existing,
}: {
  programId: string;
  weekNumber: number;
  existing?: ReadinessCheckinRow | null;
}) {
  const { run, pending, error } = usePostAction("/api/readiness");
  const [vals, setVals] = useState({
    sleep: existing?.sleep ?? 4,
    fatigue: existing?.fatigue ?? 4,
    stress: existing?.stress ?? 4,
    soreness: existing?.soreness ?? 4,
  });
  const [restingHr, setRestingHr] = useState(String(existing?.resting_hr ?? ""));
  const [hrv, setHrv] = useState(String(existing?.hrv ?? ""));
  const [saved, setSaved] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // Auto-fill resting HR / HRV from a connected wearable when the athlete hasn't
  // entered them and there's no saved check-in yet. Best-effort and non-destructive:
  // it only fills empty fields, and any error (e.g. no wearable) is ignored.
  useEffect(() => {
    if (existing || restingHr.trim() || hrv.trim()) return;
    let cancelled = false;
    fetch("/api/wearables/readiness-prefill")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { restingHr?: number | null; hrv?: number | null } | null) => {
        if (cancelled || !d) return;
        if (d.restingHr != null) setRestingHr(String(d.restingHr));
        if (d.hrv != null) setHrv(String(d.hrv));
        if (d.restingHr != null || d.hrv != null) setPrefilled(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    const body: Record<string, unknown> = { programId, weekNumber, ...vals };
    if (restingHr.trim()) body.restingHr = Number(restingHr);
    if (hrv.trim()) body.hrv = Number(hrv);
    const r = await run(body);
    if (r?.ok) setSaved(true);
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Weekly readiness — week {weekNumber}</h2>
        <span className="text-xs text-zinc-400">1 = good · 7 = bad · feeds next week&apos;s plan</span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {ITEMS.map((it) => (
          <label key={it.key} className="flex flex-col gap-1 text-sm">
            <span className="flex justify-between">
              <span className="font-medium">{it.label}</span>
              <span className="text-xs text-zinc-400">
                {it.low} → {it.high}
              </span>
            </span>
            <input
              type="range"
              min={1}
              max={7}
              value={vals[it.key]}
              onChange={(e) => {
                setVals((v) => ({ ...v, [it.key]: Number(e.target.value) }));
                setSaved(false);
              }}
              className="w-full"
            />
            <span className="text-xs text-zinc-500">Rating: {vals[it.key]}</span>
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Resting HR <span className="text-xs text-zinc-400">(optional)</span>
          <input type="number" min={25} max={150} value={restingHr}
            onChange={(e) => { setRestingHr(e.target.value); setSaved(false); setPrefilled(false); }}
            placeholder="bpm" className="w-28 rounded-md border border-zinc-300 px-2 py-1 focus:border-black focus:outline-none" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          HRV <span className="text-xs text-zinc-400">(optional)</span>
          <input type="number" min={1} max={400} value={hrv}
            onChange={(e) => { setHrv(e.target.value); setSaved(false); setPrefilled(false); }}
            placeholder="ms" className="w-28 rounded-md border border-zinc-300 px-2 py-1 focus:border-black focus:outline-none" />
        </label>
      </div>
      {prefilled && (
        <p className="mt-2 text-xs text-emerald-600">Prefilled from your connected wearable — edit if needed.</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : existing ? "Update check-in" : "Save check-in"}
        </Button>
        {saved && !error && <span className="text-sm text-green-600">Saved</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </section>
  );
}
