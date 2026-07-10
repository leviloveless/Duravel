"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Kicks the generation pipeline for a program that is still `generating`, and
 * refreshes the page when it completes. Also used to retry a `failed` program.
 * (A richer progress/loading UX is Milestone 7; the full program view is
 * Milestone 6 — this is the minimal seam that runs the pipeline end-to-end.)
 */
export default function GenerateTrigger({
  programId,
  initialStatus,
}: {
  programId: string;
  initialStatus: "generating" | "failed";
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status === "failed") {
        setError(data?.issues?.join("; ") ?? data?.error ?? "Generation failed.");
        setRunning(false);
        return;
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
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
        <p className="text-sm text-zinc-600">Building your program… this can take up to a minute.</p>
      ) : error ? (
        <>
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={run}
            className="self-start rounded-full bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-zinc-800"
          >
            Try again
          </button>
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
