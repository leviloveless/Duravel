"use client";

import { useState, useTransition } from "react";
import { deleteProgram } from "./actions";

/**
 * Two-step inline confirm for deleting a program (roadmap #1.1). A generated
 * program is an expensive LLM artifact with no undo, so a single click should
 * not destroy it. Uses an inline confirm (not window.confirm) for a consistent,
 * accessible experience.
 */
export default function DeleteProgram({ programId, title }: { programId: string; title: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (confirming) {
    return (
      <span className="flex items-center gap-1 text-xs">
        <span className="text-zinc-500">Delete?</span>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const fd = new FormData();
            fd.set("programId", programId);
            startTransition(async () => {
              await deleteProgram(fd);
            });
          }}
          className="rounded-md px-2 py-1 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Yes, delete"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-600"
      aria-label={`Delete ${title}`}
    >
      Delete
    </button>
  );
}
