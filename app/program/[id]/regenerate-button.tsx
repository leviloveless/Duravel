"use client";

import { useState } from "react";
import { usePostAction } from "@/lib/hooks/use-post-action";
import { Button } from "@/components/ui/button";

/**
 * Re-runs generation for an existing program (Tasks addition #2) — rebuilds the
 * skeleton from the saved inputs and generates fresh session content, without
 * making the user re-enter everything. Uses a two-step inline confirm (NOT
 * window.confirm, which blocks the main thread and inflates INP) since it
 * replaces the current program.
 */
export default function RegenerateButton({ programId }: { programId: string }) {
  const { run, pending, error } = usePostAction("/api/generate");
  const [confirming, setConfirming] = useState(false);

  async function recalculate() {
    setConfirming(false);
    // The hook refreshes on success and surfaces 429 / 502 (failed) as `error`.
    await run({ programId, force: true });
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-2 text-xs">
        <span className="text-zinc-500">Replace current sessions?</span>
        <Button variant="secondary" size="sm" onClick={recalculate} disabled={pending} className="rounded-full">
          Yes, recalculate
        </Button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => setConfirming(true)} disabled={pending} className="rounded-full">
        {pending && (
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {pending ? "Recalculating…" : "Recalculate"}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
