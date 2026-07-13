"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Shared client mutation hook (roadmap #2.3). Collapses the near-identical
 * fetch → parse → branch-on-ok/429 → setError → router.refresh() protocol that
 * was hand-rolled in log-session, readiness-form, adapt-review, regenerate-button
 * and generate-trigger. Returns the parsed result so callers can do any extra
 * per-endpoint checks (e.g. a 200 body with status:"failed").
 */
export interface PostResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

export interface UsePostAction {
  run: (body: unknown, opts?: { refresh?: boolean }) => Promise<PostResult | null>;
  pending: boolean;
  error: string | null;
  rateLimited: boolean;
  reset: () => void;
}

export function usePostAction(url: string): UsePostAction {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  const reset = useCallback(() => {
    setError(null);
    setRateLimited(false);
  }, []);

  const run = useCallback(
    async (body: unknown, opts?: { refresh?: boolean }): Promise<PostResult | null> => {
      setPending(true);
      setError(null);
      setRateLimited(false);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.status === 429) {
          setRateLimited(true);
          setError(
            typeof data.message === "string"
              ? data.message
              : "You've reached today's limit. Please try again later.",
          );
          return { ok: false, status: 429, data };
        }
        if (!res.ok) {
          const issues = Array.isArray(data.issues) ? data.issues.join("; ") : null;
          setError((typeof data.error === "string" ? data.error : null) ?? issues ?? "Something went wrong.");
          return { ok: false, status: res.status, data };
        }
        if (opts?.refresh !== false) router.refresh();
        return { ok: true, status: res.status, data };
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setPending(false);
      }
    },
    [url, router],
  );

  return { run, pending, error, rateLimited, reset };
}
