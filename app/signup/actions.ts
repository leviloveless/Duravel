"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  TERMS_VERSION,
  isSignupSex,
  isSignupSport,
  parseDob,
  splitName,
} from "@/lib/signup-checks";

/**
 * Account creation (2026-09-13). Replaces the "Create account" half of the
 * signin/signup toggle on `/login`, which collected only email and password.
 *
 * Everything the form collects travels as auth-user metadata rather than being
 * written here — see `lib/signup-profile.ts` for why, and for where the
 * `profiles` row actually gets created.
 */

const SignUpSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name."),
    email: z.string().email("Enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    sport: z.string().refine(isSignupSport, "Choose your primary sport."),
    sex: z.string().refine(isSignupSex, "Choose an option."),
    dobMonth: z.string(),
    dobDay: z.string(),
    dobYear: z.string(),
    // The checkbox is absent from FormData when unticked, so "on" is the only
    // accepting value and a missing field must fail rather than default.
    agree: z.literal("on", { message: "You must accept the terms to create an account." }),
  })
  .strip();

export type SignUpState = { error: string | null };

/**
 * Where Supabase sends people after they confirm, and after an OAuth round trip.
 *
 * `/auth/confirm` is reused rather than given an OAuth twin because it already
 * handles the PKCE `?code=` exchange, already establishes the session, and is
 * already the one place the welcome email fires — three things an `/auth/callback`
 * would have had to duplicate and then keep in step.
 *
 * It lands on `/setup`, not `/start`. Setup was originally reachable only from a
 * soft link at the bottom of `/start`, which meant almost nobody would have seen
 * it — and the benchmark step is the one that decides whether the athlete's first
 * program is built on their real numbers or on an assumption. `/setup` ends by
 * sending them to `/start`, so no path is lost; every step is skippable, so
 * nobody is trapped.
 */
async function authRedirectUrl(next: string): Promise<string> {
  // env wins, because Stripe and the wearable callbacks all read it and a second
  // opinion about our own origin is how an athlete gets redirected off the host
  // mid-flow. The header is the local-development fallback.
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get("origin") ?? "";
  return `${origin}/auth/confirm?next=${encodeURIComponent(next)}`;
}

export async function signUpAthlete(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const parsed = SignUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    sport: formData.get("sport"),
    sex: formData.get("sex"),
    dobMonth: formData.get("dobMonth"),
    dobDay: formData.get("dobDay"),
    dobYear: formData.get("dobYear"),
    agree: formData.get("agree"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your answers." };
  }

  // Re-run the date checks server-side. The form runs them too, but the form
  // blocks native submit, so the only enforcement that counts is this one.
  const dob = parseDob({
    month: parsed.data.dobMonth,
    day: parsed.data.dobDay,
    year: parsed.data.dobYear,
  });
  if (!dob.ok) return { error: dob.error };

  const { firstName, lastName } = splitName(parsed.data.name);
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: await authRedirectUrl("/setup"),
      data: {
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dob.iso,
        age: dob.age,
        sex: parsed.data.sex,
        primary_sport: parsed.data.sport,
        // Recorded at the moment of consent, with the version consented to. This
        // pair is what a billing or refund dispute actually turns on.
        terms_accepted_at: new Date().toISOString(),
        terms_version: TERMS_VERSION,
      },
    },
  });
  if (error) return { error: error.message };

  redirect("/login?checkEmail=1");
}

/**
 * Start an OAuth sign-in. Handles both signup and sign-in: for a provider,
 * those are the same action, and the profile row is created on first arrival at
 * `/auth/confirm` either way.
 *
 * ⚠️ Apple's guideline 4.8 makes "Sign in with Apple" MANDATORY for an iOS app
 * that offers any other third-party login — so shipping Google is what creates
 * the Apple requirement, and Apple needs Developer Program enrolment, which is
 * an open blocker. Both are wired here; only enable in Supabase what is actually
 * configured, or the button returns a provider error.
 */
async function startOAuth(provider: "google" | "apple"): Promise<never> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: await authRedirectUrl("/setup") },
  });
  if (error || !data?.url) {
    redirect(`/signup?error=${provider}`);
  }
  redirect(data.url);
}

export async function signUpWithGoogle(): Promise<never> {
  return startOAuth("google");
}

export async function signUpWithApple(): Promise<never> {
  return startOAuth("apple");
}
