"use client";

import { usePostAction } from "@/lib/hooks/use-post-action";
import { Button } from "@/components/ui/button";

/**
 * Re-runs generation for an existing program (Tasks addition #2) — rebuilds the
 * skeleton from the saved inputs and generates fresh session content, without
 * making the user re-enter everything. Asks for confirmation first since it
 * replaces the current program.
 */
export default function RegenerateButton({ programId }: { programId: string }) {
  const { run, pending, error } = usePostAction("/api/generate");

  async function recalculate() {
    if (
      !window.confirm(
        "Recalculate this program? This replaces the current sessions with a freshly generated version.",
      )
    ) {
      return;
    }
    // The hook refreshes on success and surfaces 429 / 502 (failed) as `error`.
    await run({ programId, force: true });
  }

  return (
    <span className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={recalculate} disabled={pending} className="rounded-full">
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
