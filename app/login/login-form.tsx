"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signIn, type AuthState } from "./actions";

const initialState: AuthState = { error: null };

/**
 * Sign-in only, as of 2026-09-13.
 *
 * This used to be a two-mode form with a Sign in / Create account toggle, which
 * meant account creation collected an email and a password and nothing else —
 * no name, no date of birth, no recorded consent. Creating an account now has
 * its own route (`/signup`) with its own fields, so this form does one thing.
 */
export default function LoginForm({ checkEmail }: { checkEmail: boolean }) {
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <div className="flex flex-col gap-6">
      {checkEmail && (
        <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Check your email for a confirmation link before signing in.
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <div className="flex items-center gap-2">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="current-password"
              className="flex-1 rounded-md border border-zinc-300 px-3 py-2"
            />
            <button
              type="button"
              aria-pressed={showPassword}
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((v) => !v)}
              className="text-xs text-zinc-500 underline"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </label>

        <Link href="/forgot-password" className="self-start text-sm text-zinc-500 underline">
          Forgot password?
        </Link>

        {state.error && (
          <p className="text-sm text-red-600" role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-black px-5 py-2.5 text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? "Please wait…" : "Sign in"}
        </button>
      </form>

      <p className="text-sm text-zinc-500">
        New to Duravel?{" "}
        <Link href="/signup" className="text-accent underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
