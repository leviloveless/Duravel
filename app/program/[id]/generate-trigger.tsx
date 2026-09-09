"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * Kicks the generation pipeline for a program that is still `generating`, and
 * refreshes the page when it completes. Also used to retry a `failed` program.
 *
 * Generation is a single long request (one Haiku call per mesocycle, in
 * parallel) with no server-sent progress, so the "progress" here is a friendly
 * staged message that advances on a timer while the request is in flight
 * (Milestone 7 loading UX). Rate-limit (429) and payment-required (402)
 * responses get their own messages.
 */

// Staged messages shown while the request is in flight, keyed by elapsed ms.
const PROGRESS_STAGES: { at: number; label: string }[] = [
  { at: 0, label: "Warming up the periodization engine…" },
  { at: 6000, label: "Mapping out your mesocycles…" },
  { at: 16000, label: "Filling in sessions with AI…" },
  { at: 34000, label: "Assembling and checking your program…" },
];

/**
 * When to give up client-side.
 *
 * Deliberately LONGER than the route's own `maxDuration = 60`: if we abort
 * first we turn a request the server was about to answer into a failure of our
 * own making. Five seconds of grace is enough for the response to come back over
 * a slow connection and short enough that nobody sits looking at a spinner.
 */
const GENERATE_TIMEOUT_MS = 65_000;

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-zinc-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function GenerateTrigger({
  programId,
  initialStatus,
}: {
  programId: string;
  initialStatus: "generating" | "failed";
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(PROGRESS_STAGES[0]!.label);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [paymentRequired, setPaymentRequired] = useState(false);
  const started = useRef(false);

  // Advance the staged progress message on a timer while running.
  useEffect(() => {
    if (!running) return;
    setStage(PROGRESS_STAGES[0]!.label);
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      const current = PROGRESS_STAGES.filter((s) => elapsed >= s.at).pop();
      if (current) setStage(current.label);
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  async function run() {
    setRunning(true);
    setError(null);
    setRateLimited(false);
    setPaymentRequired(false);
    // The route is capped at `maxDuration = 60`, and when the platform kills it
    // there is NO response — the fetch just dies. Every branch below reads a
    // status code, so that case fell out of the bottom into `(e as Error).message`
    // and the athlete got "Failed to fetch", or on some browsers nothing at all,
    // on a program that had in fact simply run out of time (Levi, 2026-09-09).
    //
    // Abort a little PAST the server's own ceiling, so a request the server is
    // about to answer is never cut off by us — and say what actually happened.
    const ac = new AbortController();
    const killAt = setTimeout(() => ac.abort(), GENERATE_TIMEOUT_MS);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId }),
        signal: ac.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setPaymentRequired(true);
        setError(data?.message ?? "An active subscription is required to generate programs.");
        setRunning(false);
        return;
      }
      if (res.status === 429) {
        setRateLimited(true);
        setError(data?.message ?? "You've reached today's generation limit. Please try again later.");
        setRunning(false);
        return;
      }
      if (!res.ok || data.status === "failed") {
        setError(data?.issues?.join("; ") ?? data?.error ?? "Generation failed. Please try again.");
        setRunning(false);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(
        (e as Error)?.name === "AbortError"
          ? "Your program took longer than a minute to build and the request timed out. Nothing is lost — press Try again. If it keeps timing out, a week with a lot of sessions in it is the usual reason."
          : ((e as Error).message ?? "Generation failed. Please try again."),
      );
      setRunning(false);
    } finally {
      clearTimeout(killAt);
    }
  }

  // Auto-start once for a freshly created program.
  useEffect(() => {
    if (initialStatus === "generating" && !started.current) {
      started.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-4">
      {running ? (
        <div className="flex items-center gap-2.5">
          <Spinner />
          <div className="flex flex-col">
            <p className="text-sm text-zinc-700">{stage}</p>
            <p className="text-xs text-zinc-400">This usually takes up to a minute — no need to refresh.</p>
          </div>
        </div>
      ) : error ? (
        <>
          <p className={`text-sm ${rateLimited ? "text-amber-700" : paymentRequired ? "text-zinc-700" : "text-red-600"}`}>
            {error}
          </p>
          {paymentRequired ? (
            <Link
              href="/pricing"
              className="self-start rounded-full bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-zinc-800"
            >
              View plans
            </Link>
          ) : (
            !rateLimited && (
              <button
                type="button"
                onClick={run}
                className="self-start rounded-full bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-zinc-800"
              >
                Try again
              </button>
            )
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={run}
          className="self-start rounded-full bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-zinc-800"
        >
          Generate program
        </button>
      )}
    </div>
  );
}
