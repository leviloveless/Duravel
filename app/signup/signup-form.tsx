"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SIGNUP_SPORTS, SIGNUP_SPORT_LABEL, parseDob, type SignupSport } from "@/lib/signup-checks";
import { signUpAthlete, signUpWithApple, signUpWithGoogle, type SignUpState } from "./actions";

const initialState: SignUpState = { error: null };

const FIELD =
  "rounded-md border border-line-strong px-3 py-2.5 focus:border-accent focus:outline-none";
const LABEL = "text-xs font-semibold text-zinc-700";
const HINT = "text-[11px] leading-snug text-zinc-500";

/**
 * Account creation form (2026-09-13).
 *
 * It does NOT block native submit — unlike the onboarding form, which had to,
 * and then had to re-implement every check native validation would have done.
 * Here `required`, `minLength` and `inputMode` are real enforcement, and the
 * only check the browser cannot make (is this a date, and is this person 13?)
 * is the one held locally below and re-run in the server action.
 */
export default function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpAthlete, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const [dob, setDob] = useState({ month: "", day: "", year: "" });
  const [dobTouched, setDobTouched] = useState(false);

  // Only shown once all three boxes have something in them — complaining about
  // an incomplete date while someone is still typing it is just noise.
  const dobComplete = dob.month !== "" && dob.day !== "" && dob.year.length >= 4;
  const dobCheck = dobComplete ? parseDob(dob) : null;
  const dobError = dobTouched && dobCheck && !dobCheck.ok ? dobCheck.error : null;

  const setPart = (k: keyof typeof dob) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDob((d) => ({ ...d, [k]: e.target.value.replace(/\D/g, "") }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <form action={signUpWithGoogle} className="flex-1">
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
        </form>

        <form action={signUpWithApple} className="flex-1">
          <button
            type="submit"
            className="border-line-strong flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-50"
          >
            <svg viewBox="0 0 16 20" aria-hidden="true" className="h-4 w-4" fill="currentColor">
              <path d="M13.2 10.6c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.6-1.3-.1-2.5.8-3.1.8s-1.6-.8-2.7-.7c-1.4 0-2.7.8-3.4 2-1.4 2.5-.4 6.2 1 8.2.7 1 1.5 2.1 2.6 2.1s1.4-.7 2.7-.7 1.6.7 2.7.6c1.1 0 1.8-1 2.5-2 .8-1.1 1.1-2.2 1.1-2.3-.1 0-2.2-.8-2.2-3.2zM11.1 4.4c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .1 1.9-.5 2.5-1.2z" />
            </svg>
            Continue with Apple
          </button>
        </form>
      </div>

      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200" />
        or
        <span className="h-px flex-1 bg-zinc-200" />
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className={LABEL} htmlFor="su-name">
            Full name
          </label>
          <input id="su-name" name="name" required autoComplete="name" className={FIELD} />
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL} htmlFor="su-email">
            Email
          </label>
          <input
            id="su-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={FIELD}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className={LABEL} htmlFor="su-sport">
              Primary sport
            </label>
            <select id="su-sport" name="sport" required className={FIELD} defaultValue="hyrox">
              {SIGNUP_SPORTS.map((s: SignupSport) => (
                <option key={s} value={s}>
                  {SIGNUP_SPORT_LABEL[s]}
                </option>
              ))}
            </select>
            <span className={HINT}>Sets your benchmark tables. Changeable later.</span>
          </div>

          <div className="flex flex-col gap-1">
            <label className={LABEL} htmlFor="su-sex">
              Sex
            </label>
            <select id="su-sex" name="sex" required className={FIELD} defaultValue="male">
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Prefer not to say</option>
            </select>
            <span className={HINT}>Used for heart-rate zones and division benchmarks.</span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL} htmlFor="su-password">
            Password
          </label>
          <div className="flex items-center gap-2">
            <input
              id="su-password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="8+ characters"
              className={`${FIELD} flex-1`}
            />
            <button
              type="button"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
              className="text-xs text-zinc-500 underline"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL} id="su-dob-label">
            Date of birth
          </span>
          <div className="grid grid-cols-[4.5rem_4.5rem_6rem] gap-2" aria-labelledby="su-dob-label">
            <input
              name="dobMonth"
              value={dob.month}
              onChange={setPart("month")}
              onBlur={() => setDobTouched(true)}
              required
              inputMode="numeric"
              maxLength={2}
              placeholder="MM"
              aria-label="Birth month"
              aria-invalid={dobError != null}
              className={`${FIELD} font-mono`}
            />
            <input
              name="dobDay"
              value={dob.day}
              onChange={setPart("day")}
              onBlur={() => setDobTouched(true)}
              required
              inputMode="numeric"
              maxLength={2}
              placeholder="DD"
              aria-label="Birth day"
              aria-invalid={dobError != null}
              className={`${FIELD} font-mono`}
            />
            <input
              name="dobYear"
              value={dob.year}
              onChange={setPart("year")}
              onBlur={() => setDobTouched(true)}
              required
              inputMode="numeric"
              maxLength={4}
              placeholder="YYYY"
              aria-label="Birth year"
              aria-invalid={dobError != null}
              className={`${FIELD} font-mono`}
            />
          </div>
          {dobError ? (
            <span className="text-[11px] leading-snug text-red-600" role="alert">
              {dobError}
            </span>
          ) : (
            <span className={HINT}>
              Your age sets heart-rate zones and masters benchmark bands. You must be 13 or older to
              use Duravel.
            </span>
          )}
        </div>

        <label className="flex items-start gap-2.5 text-xs leading-relaxed text-zinc-600">
          <input
            type="checkbox"
            name="agree"
            required
            className="accent-accent mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            I agree to Duravel&rsquo;s{" "}
            <Link href="/terms" className="text-accent underline">
              Terms of Use
            </Link>
            ,{" "}
            <Link href="/privacy" className="text-accent underline">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/refunds" className="text-accent underline">
              Refund Policy
            </Link>
            , and I confirm I have read the training-risk disclosure.
          </span>
        </label>

        {state.error && (
          <p className="text-sm text-red-600" role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="bg-accent hover:bg-accent-hi rounded-md px-6 py-3 font-semibold text-white transition-colors disabled:opacity-50"
        >
          {pending ? "Creating your account…" : "Create account"}
        </button>
      </form>
    </div>
  );
}
