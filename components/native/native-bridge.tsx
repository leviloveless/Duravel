"use client";

import { useEffect } from "react";
import { isNativeApp, webUrlForDeepLink } from "@/lib/native/deep-link";

/**
 * The iPhone app's side of deep links (2026-09-28). Renders nothing, and does
 * nothing at all outside the app — the Capacitor plugins are loaded only there.
 *
 * When iOS hands the app a link — the `duravel://auth/confirm?code=…` that ends a
 * Google / Apple sign-in, or a duravel.app Universal Link from an email — this
 * closes the sign-in sheet if one is open and loads the matching duravel.app
 * page in the web view. A cold start through a link is covered too: Capacitor
 * holds the event until a listener is attached.
 */
export default function NativeBridge() {
  useEffect(() => {
    if (!isNativeApp()) return;
    let removed = false;
    let remove: (() => void) | undefined;

    (async () => {
      const [{ App }, { Browser }] = await Promise.all([
        import("@capacitor/app"),
        import("@capacitor/browser"),
      ]);
      const handle = await App.addListener("appUrlOpen", ({ url }) => {
        const target = webUrlForDeepLink(url);
        if (!target) return;
        Browser.close().catch(() => {}); // no sheet open is fine
        window.location.assign(target);
      });
      if (removed) void handle.remove();
      else remove = () => void handle.remove();
    })().catch((err) => console.error("[native] deep-link listener failed:", err));

    return () => {
      removed = true;
      remove?.();
    };
  }, []);

  return null;
}
