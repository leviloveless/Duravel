"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * First-run guided walkthrough (#8) — a short step-through of how Duravel works,
 * shown once to new users and re-openable any time via the trigger. "Seen it" is
 * remembered in localStorage (no DB round-trip), so it never nags. Accessible
 * modal: focus on open, Escape to close, restore focus on close.
 */

const STORAGE_KEY = "duravel_tour_v1";

interface Step {
  emoji: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    emoji: "👋",
    title: "Welcome to Duravel",
    body: "Here's the 30-second tour of how your training works. You can reopen this any time from “How it works”.",
  },
  {
    emoji: "🧩",
    title: "Build your program",
    body: "Answer a few questions about your sport, experience, race date, and benchmarks. The engine builds a fully periodized plan — every week, every session — tailored to you.",
  },
  {
    emoji: "📅",
    title: "Train the plan",
    body: "Open a program to see it week by week. Each session tells you exactly what to do — the run, the lifts, the stations — with paces and heart-rate zones set from your numbers.",
  },
  {
    emoji: "✅",
    title: "Log as you go",
    body: "Tap “Log” on any session to record it in seconds: done / partial / skipped, how hard it felt (RPE), and optional time, distance, or heart rate. Fast enough to do at the gym.",
  },
  {
    emoji: "🫀",
    title: "Check in weekly",
    body: "A quick readiness check-in — sleep, fatigue, stress, soreness — lets the plan ease off before a rough week instead of only reacting after. Connect Strava or Oura and your recovery data fills in automatically.",
  },
  {
    emoji: "🔁",
    title: "Your plan adapts",
    body: "As you log, each week gets reviewed and the next one recalculated to match how you're actually responding — backing off if you're overreaching, pushing on if you're thriving.",
  },
];

export default function Walkthrough({
  autoStart = false,
}: {
  /** Auto-open on first visit (e.g. a brand-new user with no programs yet). */
  autoStart?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // First-run auto-open (only if they haven't seen it before).
  useEffect(() => {
    if (!autoStart) return;
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      /* localStorage unavailable — just don't auto-open */
    }
  }, [autoStart]);

  // Accessible modal behaviour.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function markSeen() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function openTour() {
    setStep(0);
    setOpen(true);
  }

  function dismiss() {
    markSeen();
    setOpen(false);
  }

  function next() {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else dismiss();
  }

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <>
      <button
        type="button"
        onClick={openTour}
        className="self-start text-sm text-zinc-500 underline hover:text-zinc-700"
      >
        How it works
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={dismiss}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tour-title"
            tabIndex={-1}
            className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl outline-none sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <span aria-hidden className="text-3xl">
                {current.emoji}
              </span>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Close"
                className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                Skip
              </button>
            </div>

            <h2 id="tour-title" className="mt-3 text-lg font-semibold">
              {current.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">{current.body}</p>

            {/* Progress dots */}
            <div className="mt-5 flex items-center justify-center gap-1.5" aria-hidden>
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step ? "w-5 bg-black" : "w-1.5 bg-zinc-300"
                  }`}
                />
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="text-sm text-zinc-500 underline disabled:opacity-0"
              >
                Back
              </button>
              <span className="text-xs text-zinc-400 tabular-nums">
                {step + 1} / {STEPS.length}
              </span>
              <Button variant="primary" size="sm" onClick={next} className="px-5">
                {isLast ? "Get started" : "Next"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
