"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * "Workout reminders" push toggle. Owns the whole browser side of web push:
 * registers the service worker, subscribes via PushManager with the VAPID
 * public key, and POSTs the subscription to /api/push/subscribe. Turning it off
 * unsubscribes locally and tells /api/push/unsubscribe to drop the row.
 *
 * Only rendered when NEXT_PUBLIC_VAPID_PUBLIC_KEY is configured (see connections
 * page). Degrades gracefully where the Push API is unavailable (e.g. iOS Safari
 * outside an installed PWA) by showing a hint instead of the switch.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = "loading" | "unsupported" | "off" | "on" | "busy";

const noSubscribe = () => () => {};

function readPushSupport(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export default function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  // null on the server (unknown); the browser answers after hydration.
  const supported = useSyncExternalStore(noSubscribe, readPushSupport, () => null);
  const status: Status = supported === false ? "unsupported" : state;

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (!cancelled) setStatus(sub ? "on" : "off");
      } catch {
        if (!cancelled) setStatus("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  async function enable() {
    setError(null);
    setStatus("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError(
          permission === "denied"
            ? "Notifications are blocked in your browser settings."
            : "Permission wasn't granted.",
        );
        setStatus("off");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) throw new Error("save failed");

      setStatus("on");
    } catch {
      setError("Couldn't enable reminders. Please try again.");
      setStatus("off");
    }
  }

  async function disable() {
    setError(null);
    setStatus("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
      setStatus("off");
    } catch {
      setStatus("off");
    }
  }

  async function sendTest() {
    setError(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error || "Test send failed.");
      }
    } catch {
      setError("Test send failed.");
    }
  }

  if (status === "unsupported") {
    return (
      <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-5">
        <span className="font-medium">Workout reminders</span>
        <span className="text-sm text-zinc-500">
          This browser doesn&apos;t support web notifications. On iPhone, add Duravel to your Home
          Screen first, then enable reminders from there.
        </span>
      </div>
    );
  }

  const on = status === "on";
  const busy = status === "busy" || status === "loading";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="font-medium">Workout reminders</span>
          <span className="text-sm text-zinc-500">
            Get a browser notification when a session is due, your week review is ready, or a streak
            is at risk.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Workout reminders"
          disabled={busy}
          onClick={on ? disable : enable}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
            on ? "bg-black" : "bg-zinc-300"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              on ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {on && (
        <button
          type="button"
          onClick={sendTest}
          className="self-start text-sm text-zinc-500 underline hover:text-zinc-800"
        >
          Send a test notification
        </button>
      )}

      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
