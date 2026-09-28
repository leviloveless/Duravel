"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SIGNUP_SPORTS, SIGNUP_SPORT_LABEL, type SignupSport } from "@/lib/signup-checks";
import type { CompletionNeeds } from "@/lib/account-completion";
import { completeAccount, type CompleteState } from "./actions";

const FIELD =
  "rounded-md border border-line-strong px-3 py-2.5 focus:border-accent focus:outline-none";
const LABEL = "text-xs font-semibold text-zinc-700";
const HINT = "text-[11px] leading-snug text-zinc-500";

/**
 * Shows only what this account is missing. The server recomputes the list, so
 * hiding a field here is presentation, not permission.
 */
export default function WelcomeForm({
  next,
  needs,
  prefill,
}: {
  next: string;
  needs: CompletionNeeds;
  prefill: {
    name: string;
    sex: string;
    sport: string;
    dobMonth: string;
    dobDay: string;
    dobYear: string;
  };
}) {
  const [state, action, pending] = useActionState<CompleteState, FormData>(completeAccount, {
    error: null,
  });
  return (
    <form
      action={action}
      className="border-line flex flex-col gap-4 rounded-xl border bg-white p-5"
    >
      <input type="hidden" name="next" value={next} />

      {needs.name ? (
        <div className="flex flex-col gap-1">
          <label className={LABEL} htmlFor="w-name">
            Your name
          </label>
          <input
            id="w-name"
            name="name"
            required
            autoComplete="name"
            defaultValue={prefill.name}
            className={FIELD}
          />
        </div>
      ) : null}

      {needs.sport || needs.sex ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {needs.sport ? (
            <div className="flex flex-col gap-1">
              <label className={LABEL} htmlFor="w-sport">
                Primary sport
              </label>
              <select
                id="w-sport"
                name="sport"
                required
                defaultValue={prefill.sport || "hyrox"}
                className={FIELD}
              >
                {SIGNUP_SPORTS.map((s: SignupSport) => (
                  <option key={s} value={s}>
                    {SIGNUP_SPORT_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {needs.sex ? (
            <div className="flex flex-col gap-1">
              <label className={LABEL} htmlFor="w-sex">
                Sex
              </label>
              <select
                id="w-sex"
                name="sex"
                required
                defaultValue={prefill.sex || "male"}
                className={FIELD}
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Prefer not to say</option>
              </select>
              <span className={HINT}>Used for heart-rate zones and division benchmarks.</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {needs.dob ? (
        <div className="flex flex-col gap-1">
          <span className={LABEL} id="w-dob-label">
            Date of birth
          </span>
          <div className="grid grid-cols-[4.5rem_4.5rem_6rem] gap-2" aria-labelledby="w-dob-label">
            <input
              name="dobMonth"
              required
              inputMode="numeric"
              maxLength={2}
              placeholder="MM"
              aria-label="Birth month"
              defaultValue={prefill.dobMonth}
              className={`${FIELD} font-mono`}
            />
            <input
              name="dobDay"
              required
              inputMode="numeric"
              maxLength={2}
              placeholder="DD"
              aria-label="Birth day"
              defaultValue={prefill.dobDay}
              className={`${FIELD} font-mono`}
            />
            <input
              name="dobYear"
              required
              inputMode="numeric"
              maxLength={4}
              placeholder="YYYY"
              aria-label="Birth year"
              defaultValue={prefill.dobYear}
              className={`${FIELD} font-mono`}
            />
          </div>
          <span className={HINT}>
            Your age sets heart-rate zones and masters benchmark bands. You must be 13 or older to
            use Duravel.
          </span>
        </div>
      ) : null}

      {needs.password ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className={LABEL} htmlFor="w-pw">
              Choose a password
            </label>
            <input
              id="w-pw"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="8+ characters"
              className={FIELD}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={LABEL} htmlFor="w-pw2">
              Confirm password
            </label>
            <input
              id="w-pw2"
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={FIELD}
            />
          </div>
        </div>
      ) : null}

      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-zinc-600">
        <input
          type="checkbox"
          name="agree"
          required
          className="accent-accent mt-0.5 h-4 w-4 shrink-0"
        />
        <span>
          I agree to Duravel&rsquo;s{" "}
          <Link href="/terms" target="_blank" className="text-accent underline">
            Terms of Use
          </Link>
          ,{" "}
          <Link href="/privacy" target="_blank" className="text-accent underline">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/refunds" target="_blank" className="text-accent underline">
            Refund Policy
          </Link>
          .
        </span>
      </label>

      {state.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="bg-accent hover:bg-accent-hi rounded-md px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
