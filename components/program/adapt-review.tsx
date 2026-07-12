"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Weekly review banner (Phase 2, Milestone 10 — phase2-spec.md §3b).
 *
 * Surfaces when a program week has ended and hasn't been reviewed. Fetches
 * the deterministic preview (free, no AI), shows planned vs. actual and the
 * engine's proposed adjustment in plain language, and lets the user Apply
 * (one Haiku refill of the upcoming week) or Keep as planned.
 */

interface PreviewResponse {
  weekNumber: number;
  targetWeek: number;
  signals: {
    plannedSessions: number;
    compliance: number;
    strain: number | null;
    actualMileage: number;
    actualCardioMinutes: number;
    plannedMileage: number;
    plannedCardioMinutes: number;
  };
  decision: {
    rule: string;
    reason: string;
    revisedTargets: { targetMileage: number; targetCardioMinutes: number } | null;
  };
  nextOriginal: { targetMileage: number; targetCardioMinutes: number } | null;
}

const RULE_LABEL: Record<string, string> = {
  none: "No change",
  hold: "Hold volume",
  early_deload: "Early deload",
  protect_long_run: "Protect the long run",
  earned_bump: "Earned bump",
  re_anchor: "Re-anchor",
};

export default function AdaptReview({ programId, weekNumber }: { programId: string; weekNumber: number }) {
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState<"apply" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/adapt/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ programId, weekNumber }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setLoadError(data?.error ?? "Couldn't load the weekly review.");
        else setPreview(data as PreviewResponse);
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [programId, weekNumber]);

  async function resolve(decision: "apply" | "dismiss") {
    setRunning(decision);
    setError(null);
    try {
      const res = await fetch("/api/adapt/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId, weekNumber, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? "Something went wrong.");
        setRunning(null);
        return;
      }
      router.refresh(); // banner disappears; adapted week re-renders
    } catch (e) {
      setError((e as Error).message);
      setRunning(null);
    }
  }

  if (loadError) return null; // never block the program view over a review hiccup

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-indigo-900">Review week {weekNumber}</h2>
        {preview && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
            {RULE_LABEL[preview.decision.rule] ?? preview.decision.rule}
          </span>
        )}
      </div>

      {!preview ? (
        <p className="mt-2 text-sm text-indigo-800/70">Checking your week…</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-indigo-900">
            <span>
              <span className="text-xs text-indigo-800/60">Sessions</span>{" "}
              <span className="font-medium">{Math.round(preview.signals.compliance * 100)}%</span>
            </span>
            <span>
              <span className="text-xs text-indigo-800/60">Mileage</span>{" "}
              <span className="font-medium">
                {preview.signals.actualMileage} / {preview.signals.plannedMileage} mi
              </span>
            </span>
            <span>
              <span className="text-xs text-indigo-800/60">Cardio</span>{" "}
              <span className="font-medium">
                {preview.signals.actualCardioMinutes} / {preview.signals.plannedCardioMinutes} min
              </span>
            </span>
            {preview.signals.strain !== null && (
              <span>
                <span className="text-xs text-indigo-800/60">Avg effort</span>{" "}
                <span className="font-medium">RPE {preview.signals.strain}</span>
              </span>
            )}
          </div>

          <p className="mt-2 text-sm text-indigo-900">{preview.decision.reason}</p>

          {preview.decision.revisedTargets && preview.nextOriginal && (
            <p className="mt-1 text-xs text-indigo-800/70">
              Week {preview.targetWeek}: {preview.nextOriginal.targetMileage} →{" "}
              <span className="font-semibold">{preview.decision.revisedTargets.targetMileage} mi</span>
              {" · "}
              {preview.nextOriginal.targetCardioMinutes} →{" "}
              <span className="font-semibold">{preview.decision.revisedTargets.targetCardioMinutes} min</span>
            </p>
          )}

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => resolve("apply")}
              disabled={running !== null}
              className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {running === "apply" ? "Applying…" : preview.decision.rule !== "none" ? "Apply adjustment" : "Sounds good"}
            </button>
            <button
              type="button"
              onClick={() => resolve("dismiss")}
              disabled={running !== null}
              className="rounded-full px-4 py-2 text-sm text-indigo-900/70 hover:bg-indigo-100 disabled:opacity-50"
            >
              {running === "dismiss" ? "Saving…" : "Keep as planned"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
