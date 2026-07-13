import type { InputHTMLAttributes } from "react";

/**
 * Shared text/number input primitive (roadmap #2.3) — the bordered input class
 * was re-inlined in onboarding, profile, login, and the log/readiness forms.
 */
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-md border border-zinc-300 px-3 py-2 focus:border-black focus:outline-none ${className}`}
      {...props}
    />
  );
}
