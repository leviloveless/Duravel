"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ResetRequestState } from "../login/actions";

const initialState: ResetRequestState = { error: null, sent: false };

export default function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  if (state.sent) {
    return (
      <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        If an account exists for that email, we&apos;ve sent a password reset link. Check your
        inbox (and your spam or promotions folder).
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          name="email"
          type="email"
          required
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-black px-5 py-2.5 text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "Please wait…" : "Send reset link"}
      </button>
    </form>
  );
}
