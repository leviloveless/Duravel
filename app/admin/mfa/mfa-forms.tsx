"use client";

import { useActionState } from "react";
import { startEnrollment, verifyCode, type EnrollState, type VerifyState } from "./actions";

const input =
  "w-40 rounded-md border border-line-strong bg-white px-3 py-2 text-center font-mono text-lg tracking-[0.3em] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
const button =
  "inline-flex items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60";

function CodeForm({ factorId, label }: { factorId: string; label: string }) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(verifyCode, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="factorId" value={factorId} />
      <label htmlFor="code" className="text-sm text-zinc-700">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="\d{6}"
          required
          autoFocus
          className={input}
        />
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Checking…" : "Verify"}
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** Code entry for an admin who already has an authenticator enrolled. */
export function MfaVerify({ factorId }: { factorId: string }) {
  return (
    <CodeForm factorId={factorId} label="Enter the 6-digit code from your authenticator app." />
  );
}

/** First-time setup: show a QR code, then confirm with a code from the app. */
export function MfaEnroll() {
  const [state, start, pending] = useActionState<EnrollState>(startEnrollment, { step: "idle" });

  if (state.step === "idle") {
    return (
      <form action={start} className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-zinc-700">
          You&apos;ll need an authenticator app — 1Password, Google Authenticator, Authy, or the one
          built into your iPhone&apos;s Passwords app.
        </p>
        <div>
          <button type="submit" disabled={pending} className={button}>
            {pending ? "Starting…" : "Set up two-factor"}
          </button>
        </div>
        {state.error ? (
          <p role="alert" className="text-sm text-red-800">
            {state.error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-start gap-4 sm:flex-row">
        {/* The QR is an SVG data URL from Supabase, rendered locally — nothing is sent anywhere. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={state.qr}
          alt="QR code to add Duravel admin to your authenticator app"
          width={180}
          height={180}
          className="border-line rounded-lg border bg-white p-2"
        />
        <div className="text-sm leading-relaxed text-zinc-700">
          <p>Scan this with your authenticator app.</p>
          <p className="mt-3 text-xs text-zinc-500">Can&apos;t scan? Enter this key instead:</p>
          <p className="mt-1 font-mono text-xs break-all text-zinc-800 select-all">
            {state.secret}
          </p>
        </div>
      </div>
      <CodeForm factorId={state.factorId} label="Then enter the 6-digit code it shows to finish." />
    </div>
  );
}
