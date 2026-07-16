"use client";

import { useActionState, useState } from "react";
import { updatePassword, type AuthState } from "../../login/actions";

const initialState: AuthState = { error: null };

export default function UpdatePasswordForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        New password
        <div className="flex items-center gap-2">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            required
            minLength={8}
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

      <label className="flex flex-col gap-1 text-sm">
        Confirm new password
        <input
          name="confirmPassword"
          type={showPassword ? "text" : "password"}
          required
          minLength={8}
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-black px-5 py-2.5 text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "Please wait…" : "Update password"}
      </button>
    </form>
  );
}
