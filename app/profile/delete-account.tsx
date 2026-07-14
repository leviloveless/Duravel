"use client";

import { useActionState, useState } from "react";
import { deleteAccount, type DeleteState } from "./actions";

const initialState: DeleteState = { error: null };

/**
 * Danger-zone account deletion with a two-step confirm (App Store 5.1.1(v)).
 * The first click reveals a confirmation panel; the irreversible action runs
 * only on explicit confirm.
 */
export default function DeleteAccount() {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(deleteAccount, initialState);

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50/50 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-red-800">Delete account</h2>
        <p className="text-sm text-zinc-600">
          Permanently delete your account and all of your programs, logs, and data. This can&apos;t
          be undone.
        </p>
      </div>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start rounded-full border border-red-300 px-5 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
        >
          Delete my account
        </button>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <p className="text-sm font-medium text-red-800">
            Are you sure? This permanently deletes your account and everything in it.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-red-600 px-5 py-2 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              {pending ? "Deleting…" : "Yes, permanently delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded-full border border-zinc-300 px-5 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        </form>
      )}
    </div>
  );
}
