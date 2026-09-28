"use client";

import { useState, type ReactNode } from "react";
import { oauthUrlForApp, signUpWithApple, signUpWithGoogle } from "@/app/signup/actions";
import { isNativeApp } from "@/lib/native/deep-link";

/**
 * One "Continue with …" button (2026-09-28).
 *
 * On the web it is a plain form posting to the server action, which redirects to
 * the provider — no JavaScript needed. In the iPhone app the submit is taken over:
 * the provider opens in an in-app Safari sheet (Google blocks sign-in inside web
 * views), and the app's deep-link handler brings the result back
 * (components/native/native-bridge.tsx).
 */
export default function OAuthForm({
  provider,
  next,
  children,
}: {
  provider: "google" | "apple";
  next: "/setup" | "/dashboard";
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);

  async function openInApp(e: React.FormEvent<HTMLFormElement>) {
    if (!isNativeApp()) return; // the web: let the form post normally
    e.preventDefault();
    setError(null);
    const res = await oauthUrlForApp(provider, next);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: res.url, presentationStyle: "popover" });
  }

  return (
    <form
      action={provider === "google" ? signUpWithGoogle : signUpWithApple}
      onSubmit={openInApp}
      className="flex-1"
    >
      <input type="hidden" name="next" value={next} />
      {children}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
