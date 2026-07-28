"use client";

import { useActionState, useState } from "react";
import {
  changeEmail,
  changePassword,
  type EmailState,
  type PasswordState,
} from "@/app/account/actions";

const emailInitial: EmailState = { error: null, sent: false };
const passwordInitial: PasswordState = { error: null, done: false };

/**
 * Account & security block on the profile page: shows the email the user signs
 * in with, and reveals inline "change email" / "change password" forms on
 * demand. Email changes go through a confirmation link; password changes apply
 * immediately for the signed-in session.
 */
export default function AccountSecurity({ email }: { email: string }) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [emailState, emailAction, emailPending] = useActionState(changeEmail, emailInitial);
  const [pwState, pwAction, pwPending] = useActionState(changePassword, passwordInitial);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Account &amp; security</h2>
        <p className="text-sm text-zinc-500">The email and password you use to sign in.</p>
      </div>

      {/* Email */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col">
            <span className="text-xs uppercase tracking-wide text-zinc-400">Email</span>
            <span className="truncate text-sm text-zinc-800">{email || "—"}</span>
          </div>
          <button
            type="button"
            onClick={() => setEmailOpen((o) => !o)}
            className="shrink-0 text-sm text-zinc-600 underline hover:text-black"
          >
            {emailOpen ? "Cancel" : "Change email"}
          </button>
        </div>

        {emailOpen &&
          (emailState.sent ? (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Check your new inbox — we sent a link to confirm the change. Your email updates once
              you click it.
            </p>
          ) : (
            <form action={emailAction} className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                New email
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="rounded-md border border-zinc-300 px-3 py-2"
                />
              </label>
              {emailState.error && <p className="text-sm text-red-600">{emailState.error}</p>}
              <button
                type="submit"
                disabled={emailPending}
                className="self-start rounded-full bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                {emailPending ? "Sending…" : "Send confirmation link"}
              </button>
            </form>
          ))}
      </div>

      <div className="h-px bg-zinc-100" />

      {/* Password */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-zinc-400">Password</span>
            <span className="text-sm text-zinc-800">••••••••</span>
          </div>
          <button
            type="button"
            onClick={() => setPwOpen((o) => !o)}
            className="shrink-0 text-sm text-zinc-600 underline hover:text-black"
          >
            {pwOpen ? "Cancel" : "Change password"}
          </button>
        </div>

        {pwOpen &&
          (pwState.done ? (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Password updated.
            </p>
          ) : (
            <form action={pwAction} className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                New password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="rounded-md border border-zinc-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Confirm new password
                <input
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="rounded-md border border-zinc-300 px-3 py-2"
                />
              </label>
              {pwState.error && <p className="text-sm text-red-600">{pwState.error}</p>}
              <button
                type="submit"
                disabled={pwPending}
                className="self-start rounded-full bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                {pwPending ? "Updating…" : "Update password"}
              </button>
            </form>
          ))}
      </div>
    </section>
  );
}
