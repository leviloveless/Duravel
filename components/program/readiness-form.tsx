"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReadinessCheckinRow } from "@/lib/supabase/queries";

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
  const router = useRouter();
  const [vals, setVals] = useState({
    sleep: existing?.sleep ?? 4,
    fatigue: existing?.fatigue ?? 4,
    stress: existing?.stress ?? 4,
    soreness: existing?.soreness ?? 4,
  });
  const [restingHr, setRestingHr] = useState(String(existing?.resting_hr ?? ""));
  const [hrv, setHrv] = useState(String(existing?.hrv ?? ""));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { programId, weekNumber, ...vals };
      if (restingHr.trim()) body.restingHr = Number(restingHr);
      if (hrv.trim()) body.hrv = Number(hrv);
      const res = await fetch("/api/readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Could not save");
      }
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
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
              onChange={(e) => setVals((v) => ({ ...v, [it.key]: Number(e.target.value) }))}
              className="w-full"
            />
            <span className="text-xs text-zinc-500">Rating: {vals[it.key]}</span>
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Resting HR <span className="text-xs text-zinc-400">(optional)</span>
          <input type="number" min={25} max={150} value={restingHr} onChange={(e) => setRestingHr(e.target.value)}
            placeholder="bpm" className="w-28 rounded-md border border-zinc-300 px-2 py-1 focus:border-black focus:outline-none" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          HRV <span className="text-xs text-zinc-400">(optional)</span>
          <input type="number" min={1} max={400} value={hrv} onChange={(e) => setHrv(e.target.value)}
            placeholder="ms" className="w-28 rounded-md border border-zinc-300 px-2 py-1 focus:border-black focus:outline-none" />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? "Saving…" : existing ? "Update check-in" : "Save check-in"}
        </button>
        {saved && !error && <span className="text-sm text-green-600">Saved</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </section>
  );
}
