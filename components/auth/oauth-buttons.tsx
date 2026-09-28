import OAuthForm from "./oauth-form";

/**
 * "Continue with Google / Apple" (2026-09-28: shared by /signup and /login).
 *
 * For a provider, signing up and signing in are the same action — Supabase
 * creates the account on first arrival and signs in after that — so both pages
 * use the same two server actions. A new OAuth account has no date of birth or
 * Terms acceptance yet; the first-login step (/welcome) collects them.
 *
 * In the iPhone app each button opens its provider in an in-app Safari sheet
 * instead (./oauth-form.tsx).
 *
 * Guideline 4.8: an iOS app that offers Google sign-in must also offer Sign in
 * with Apple, which is why the two ship together.
 */
export default function OAuthButtons({
  next = "/setup",
}: {
  /** Where to land afterwards: /setup for a new account, /dashboard from sign-in. */
  next?: "/setup" | "/dashboard";
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <OAuthForm provider="google" next={next}>
        <button
          type="submit"
          className="border-line-strong flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-50"
        >
          <svg viewBox="0 0 18 18" aria-hidden="true" className="h-4 w-4">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
            />
          </svg>
          Continue with Google
        </button>
      </OAuthForm>

      <OAuthForm provider="apple" next={next}>
        <button
          type="submit"
          className="border-line-strong flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-50"
        >
          <svg viewBox="0 0 16 20" aria-hidden="true" className="h-4 w-4" fill="currentColor">
            <path d="M13.2 10.6c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.6-1.3-.1-2.5.8-3.1.8s-1.6-.8-2.7-.7c-1.4 0-2.7.8-3.4 2-1.4 2.5-.4 6.2 1 8.2.7 1 1.5 2.1 2.6 2.1s1.4-.7 2.7-.7 1.6.7 2.7.6c1.1 0 1.8-1 2.5-2 .8-1.1 1.1-2.2 1.1-2.3-.1 0-2.2-.8-2.2-3.2zM11.1 4.4c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .1 1.9-.5 2.5-1.2z" />
          </svg>
          Continue with Apple
        </button>
      </OAuthForm>
    </div>
  );
}
