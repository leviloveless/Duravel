"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * Lets an athlete close the announcement. Remembered per announcement id in
 * localStorage, so a NEW announcement shows again even after they closed the
 * last one. Storage can be unavailable (private browsing, blocked storage) —
 * then the banner simply stays, even after a click, which is the safe failure.
 *
 * `useSyncExternalStore` rather than an effect that sets state: the server
 * snapshot is "not dismissed", so server and first client render agree and
 * there is no hydration mismatch; the client snapshot then reads storage. A
 * dismissal notifies subscribers directly, and other tabs hear it through the
 * `storage` event.
 */
const KEY = "duravel.dismissedAnnouncement";
const listeners = new Set<() => void>();

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export default function AnnouncementDismiss({ id, children }: { id: number; children: ReactNode }) {
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => null);
  if (dismissed === String(id)) return null;
  return (
    <div className="relative">
      {children}
      <button
        type="button"
        aria-label="Dismiss announcement"
        onClick={() => {
          try {
            window.localStorage.setItem(KEY, String(id));
          } catch {
            /* storage unavailable: nothing to remember it in */
          }
          listeners.forEach((l) => l());
        }}
        className="absolute top-1/2 right-3 -translate-y-1/2 rounded px-2 py-0.5 text-base leading-none text-zinc-500 hover:bg-black/5 hover:text-zinc-800"
      >
        ×
      </button>
    </div>
  );
}
