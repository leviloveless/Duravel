"use client";

import { useState } from "react";
import ResultCardLauncher from "./result-card-launcher";
import type { CardData } from "./result-card";
import type { SessionSummary } from "@/lib/program/session-summary";

/**
 * Per-workout share controls: the card image AND the Strava description
 * (Levi, 2026-08-04).
 *
 * Renders on EVERY session row, planned or completed. Previously the Share
 * launcher only appeared once a workout was logged, so there was no way to get a
 * card — or any description at all — for a workout you were about to do.
 *
 * Three affordances, in the order they're useful:
 *   - "Share"  — opens the existing 1080px card studio, prefilled.
 *   - "Copy"   — the description on the clipboard, ready to paste into Strava.
 *   - "To Strava" — writes it straight onto the linked activity. Only rendered
 *     when an activity IS linked and the write path is enabled; it needs the
 *     `activity:write` scope, so a connection made before that grant returns
 *     `reconnect_required` and we say so in place rather than failing silently.
 */
export default function SessionShare({
  summary,
  activityId,
  programName,
  weekNumber,
  stravaWriteEnabled = false,
}: {
  summary: SessionSummary;
  /** Linked Strava activity, when there is one. */
  activityId?: string | null;
  programName?: string | null;
  weekNumber?: number;
  stravaWriteEnabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState<null | "ok" | "reconnect" | "error">(null);

  const link = "text-xs font-medium text-lime-700 transition-colors hover:text-lime-900";

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary.stravaDescription);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function postToStrava() {
    if (!activityId || posting) return;
    setPosting(true);
    setPosted(null);
    try {
      const res = await fetch("/api/wearables/strava/brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId,
          description: summary.stravaDescription,
          programName: programName ?? undefined,
          weekNumber,
          sessionLabel: summary.cardData.sessType,
        }),
      });
      if (res.ok) setPosted("ok");
      else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setPosted(body?.error === "reconnect_required" ? "reconnect" : "error");
      }
    } catch {
      setPosted("error");
    } finally {
      setPosting(false);
    }
  }

  return (
    <>
      <ResultCardLauncher
        label="Share"
        className={link}
        initial={summary.cardData as Partial<CardData>}
      />
      <button type="button" onClick={copy} className={link} title="Copy the Strava description">
        {copied ? "Copied" : "Copy"}
      </button>
      {stravaWriteEnabled && activityId && (
        <button type="button" onClick={postToStrava} disabled={posting} className={link}>
          {posting
            ? "Posting…"
            : posted === "ok"
              ? "Posted"
              : posted === "reconnect"
                ? "Reconnect Strava"
                : posted === "error"
                  ? "Retry"
                  : "To Strava"}
        </button>
      )}
    </>
  );
}
