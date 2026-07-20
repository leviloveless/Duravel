"use client";

import { useState } from "react";
import ResultCardStudio from "./result-card-studio";
import type { CardData } from "./result-card";

/**
 * Tiny client trigger for the result-card studio. Lives in the (server) program
 * view header: renders a "Result card" button and owns the modal's open state.
 */
export default function ResultCardLauncher({ initial }: { initial?: Partial<CardData> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
      >
        Result card
      </button>
      <ResultCardStudio open={open} onClose={() => setOpen(false)} initial={initial} />
    </>
  );
}
