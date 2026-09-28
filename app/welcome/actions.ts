"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProfileFromSignup } from "@/lib/signup-profile";
import {
  TERMS_VERSION,
  isSignupSex,
  isSignupSport,
  parseDob,
  splitName,
} from "@/lib/signup-checks";
import { completionNeeds, needsCompletion, safeNext } from "@/lib/account-completion";

export type CompleteState = { error: string | null };

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Finish an account on first login (2026-09-28). What is asked is recomputed
 * HERE from the signed-in user, never taken from the form, so a tampered form
 * cannot skip a step. Everything collected is written twice: to the auth user's
 * metadata, which is what the proxy checks on each navigation, and to the
 * `profiles` row, which is the record — `terms_accepted_at` and `terms_version`
 * there are what a billing dispute turns on.
 */
export async function completeAccount(
  _prev: CompleteState,
  form: FormData,
): Promise<CompleteState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const next = safeNext(field(form, "next"));
  const needs = completionNeeds(user.user_metadata);
  if (!needsCompletion(needs)) redirect(next);

  const meta: Record<string, unknown> = {};
  const profile: Record<string, unknown> = {};

  if (needs.name) {
    const name = field(form, "name");
    if (!name) return { error: "Enter your name." };
    const { firstName, lastName } = splitName(name);
    meta.first_name = firstName;
    meta.last_name = lastName;
    profile.first_name = firstName;
    profile.last_name = lastName;
  }
  if (needs.dob) {
    const dob = parseDob({
      month: field(form, "dobMonth"),
      day: field(form, "dobDay"),
      year: field(form, "dobYear"),
    });
    if (!dob.ok) return { error: dob.error };
    meta.date_of_birth = dob.iso;
    meta.age = dob.age;
    profile.date_of_birth = dob.iso;
    profile.age = dob.age;
  }
  if (needs.sex) {
    const sex = field(form, "sex");
    if (!isSignupSex(sex)) return { error: "Choose an option for sex." };
    meta.sex = sex;
    profile.sex = sex;
  }
  if (needs.sport) {
    const sport = field(form, "sport");
    if (!isSignupSport(sport)) return { error: "Choose your primary sport." };
    meta.primary_sport = sport;
    profile.primary_sport = sport;
  }
  let password: string | undefined;
  if (needs.password) {
    password = form.get("password")?.toString() ?? "";
    if (password.length < 8) return { error: "Choose a password of at least 8 characters." };
    if (password !== (form.get("confirmPassword")?.toString() ?? "")) {
      return { error: "The two passwords don't match." };
    }
    meta.password_set = true;
  }
  if (form.get("agree") !== "on") {
    return { error: "You need to accept the Terms of Use to continue." };
  }
  const acceptedAt = new Date().toISOString();
  meta.terms_accepted_at = acceptedAt;
  meta.terms_version = TERMS_VERSION;
  profile.terms_accepted_at = acceptedAt;
  profile.terms_version = TERMS_VERSION;

  const { error } = await supabase.auth.updateUser({
    ...(password ? { password } : {}),
    data: meta,
  });
  if (error) return { error: error.message };

  // Make sure a profile row exists (created from the metadata just written), then
  // record the answers on it. The update is scoped to the athlete's own row.
  await ensureProfileFromSignup(supabase);
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ ...profile, updated_at: acceptedAt })
    .eq("id", user.id);
  if (profileError) console.error("[welcome] profile update failed:", profileError.message);

  redirect(next);
}
