"use client";

import { useState, useTransition } from "react";
import { recalcProgramAsAdmin, renameProgramAsAdmin } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

/**
 * Admin quick controls for a program (#15): rename + recalculate on the athlete's
 * behalf. Recalc re-runs the generation pipeline (service role), so it isn't
 * rate-limited like the athlete's own recalculate. Uses a two-step inline confirm
 * (NOT window.confirm, which blocks the main thread and inflates INP).
 */
export default function AdminProgramControls({
  programId,
  currentName,
}: {
  programId: string;
  currentName: string;
}) {
  const [name, setName] = useState(currentName);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  function rename() {
    setMsg(null);
    start(async () => {
      const r = await renameProgramAsAdmin(programId, name);
      setMsg(r.ok ? "Renamed." : r.error);
    });
  }

  function recalc() {
    setConfirming(false);
    setMsg(null);
    start(async () => {
      const r = await recalcProgramAsAdmin(programId);
      setMsg(r.ok ? "Recalculated." : r.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-800"
      />
      <Button variant="secondary" size="sm" onClick={rename} disabled={pending || name === currentName}>
        Rename
      </Button>
      {confirming ? (
        <span className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Replace this athlete&apos;s sessions?</span>
          <Button variant="secondary" size="sm" onClick={recalc} disabled={pending}>
            {pending ? "Working…" : "Yes, recalculate"}
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
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setConfirming(true)} disabled={pending}>
          {pending ? "Working…" : "Recalculate"}
        </Button>
      )}
      {msg && <span className="text-xs text-zinc-500">{msg}</span>}
    </div>
  );
}
