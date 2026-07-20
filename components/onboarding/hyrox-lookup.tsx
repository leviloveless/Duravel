"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { HyroxSplit } from "@/lib/hyrox-results";

/**
 * HYROX result lookup + confirm flow (#17). Search by name → pick the result
 * that's yours → get your finish time plus the full segment breakdown (each
 * running leg + each station) to use as a benchmark. HYROX only. `onPick` lets a
 * parent (e.g. onboarding) auto-fill a field; standalone it just shows the result.
 *
 * The search returns the finish time inline; the per-segment splits are fetched
 * on pick from `/api/hyrox-splits`. Splits are a bonus on top of the finish time,
 * so a splits failure is silent — the confirmed finish time still shows.
 */

export interface HyroxCandidate {
  id: string;
  name: string | null;
  division: string | null;
  event: string | null;
  season: string | null;
  totalTimeMs: number | null;
  finishTime: string;
  splits: HyroxSplit[];
}

export default function HyroxLookup({
  onPick,
  defaultFirst = "",
  defaultLast = "",
}: {
  onPick?: (result: HyroxCandidate) => void;
  defaultFirst?: string;
  defaultLast?: string;
}) {
  const [first, setFirst] = useState(defaultFirst);
  const [last, setLast] = useState(defaultLast);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<HyroxCandidate[]>([]);
  const [picked, setPicked] = useState<HyroxCandidate | null>(null);
  const [splitsLoading, setSplitsLoading] = useState(false);

  async function search() {
    if (!last.trim()) {
      setError("Enter your surname to search.");
      return;
    }
    setError(null);
    setLoading(true);
    setPicked(null);
    try {
      const res = await fetch("/api/hyrox-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first, last }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error === "rate_limited"
            ? "Too many lookups right now — try again in a minute."
            : data.error === "not_configured"
              ? "Result lookup isn't available yet."
              : `Couldn't search results${data.upstream ? ` (server ${data.upstream})` : ""} — try again.`,
        );
        setCandidates([]);
      } else {
        setCandidates((data.candidates as HyroxCandidate[]) ?? []);
      }
      setSearched(true);
    } catch {
      setError("Couldn't search results — try again.");
    } finally {
      setLoading(false);
    }
  }

  async function pick(c: HyroxCandidate) {
    setPicked(c);
    onPick?.(c);
    // Splits aren't in the search response — fetch them for the chosen result.
    if (c.splits.length === 0) {
      setSplitsLoading(true);
      try {
        const res = await fetch("/api/hyrox-splits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: c.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.splits) && data.splits.length > 0) {
          const withSplits = { ...c, splits: data.splits as HyroxSplit[] };
          // Guard against a late response after the user searched again / re-picked.
          setPicked((cur) => (cur && cur.id === c.id ? withSplits : cur));
        }
      } catch {
        // Splits are a nice-to-have; the finish time already shows.
      } finally {
        setSplitsLoading(false);
      }
    }
  }

  if (picked) {
    const runs = picked.splits.filter((s) => s.kind === "run");
    const stations = picked.splits.filter((s) => s.kind === "station");
    const roxzone = picked.splits.find((s) => s.kind === "roxzone");
    const runTotal = picked.splits.find((s) => s.key === "run_time");

    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <p className="text-sm font-semibold text-emerald-900">✓ Result confirmed</p>
        <p className="mt-1 text-sm text-emerald-800">
          {picked.name ?? "You"}
          {picked.event ? ` · ${picked.event}` : ""}
          {picked.division ? ` · ${picked.division}` : ""}
        </p>
        <p className="mt-2 text-3xl font-bold text-emerald-900">{picked.finishTime}</p>

        {splitsLoading && (
          <p className="mt-3 text-xs text-emerald-700">Loading your splits…</p>
        )}

        {runs.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Running legs{runTotal ? ` · ${runTotal.time} total` : ""}
            </p>
            <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-emerald-800 sm:grid-cols-4">
              {runs.map((s) => (
                <li key={s.key} className="flex justify-between gap-2">
                  <span className="truncate">{s.label}</span>
                  <span className="tabular-nums font-medium">{s.time}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {stations.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Stations</p>
            <ul className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-emerald-800 sm:grid-cols-2">
              {stations.map((s) => (
                <li key={s.key} className="flex justify-between gap-2">
                  <span className="truncate">{s.label}</span>
                  <span className="tabular-nums font-medium">
                    {s.time}
                    {s.place != null ? (
                      <span className="ml-1 font-normal text-emerald-600">#{s.place}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {roxzone && (
          <p className="mt-3 text-xs text-emerald-700">
            Roxzone (transitions): <span className="tabular-nums font-medium">{roxzone.time}</span>
          </p>
        )}

        {!onPick && (
          <p className="mt-3 text-xs text-emerald-700">
            Use this as your HYROX goal / benchmark finish time in your profile.
          </p>
        )}
        <button
          type="button"
          onClick={() => setPicked(null)}
          className="mt-3 text-xs text-emerald-700 underline"
        >
          Not you? Search again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          placeholder="First name"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <input
          value={last}
          onChange={(e) => setLast(e.target.value)}
          placeholder="Surname"
          onKeyDown={(e) => e.key === "Enter" && void search()}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" onClick={() => void search()} disabled={loading}>
          {loading ? "Searching…" : "Find my HYROX result"}
        </Button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {searched && !loading && candidates.length === 0 && !error && (
        <p className="text-sm text-zinc-500">
          No results found for that name. Check the spelling, or enter your time manually.
        </p>
      )}

      {candidates.length > 0 && (
        <ul className="flex flex-col gap-2">
          {candidates.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-800">
                  {c.name ?? "HYROX result"}
                  {c.division ? <span className="font-normal text-zinc-500"> · {c.division}</span> : null}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {[c.event, c.season].filter(Boolean).join(" · ") || "HYROX"} · {c.finishTime}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void pick(c)}
                className="shrink-0 rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
              >
                This is me
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
