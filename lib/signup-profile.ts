import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Create the `profiles` row for a brand-new account, from the metadata signup
 * stashed on the auth user (2026-09-13).
 *
 * WHY THE FIELDS TRAVEL AS AUTH METADATA. With email confirmation on,
 * `supabase.auth.signUp` returns NO session — so the signup action cannot insert
 * a `profiles` row, because every table in this app is behind RLS scoped to
 * `auth.uid()` and there is no uid yet. The two ways out are a service-role
 * write from the signup action, or carrying the answers on the auth user until a
 * session exists. This is the second. It matters that it is: the Stripe webhook
 * is deliberately the ONLY service-role writer in the app, and a second one
 * would mean two places that can write a row RLS is supposed to own.
 *
 * So signup passes the answers as `options.data`, Supabase stores them on
 * `auth.users.raw_user_meta_data`, and this runs from `/auth/confirm` — which
 * already establishes a session for all three arrival paths (token hash, PKCE
 * code, and an already-confirmed link) before it redirects.
 *
 * IT MUST NEVER CLOBBER AN EXISTING PROFILE. `/auth/confirm` is re-entered
 * routinely: email scanners prefetch the link, people click it twice, and a
 * password-recovery link lands on the same route. By then the athlete may have
 * completed onboarding, which writes the real profile. So this fills only the
 * columns that are still null and returns early when a row already exists —
 * `trial_started_at` in particular must keep its original value, or clicking an
 * old confirmation email would silently restart someone's 14-day trial.
 *
 * OAUTH ARRIVES HERE TOO, with a name from Google or Apple and nothing else.
 * That is fine and intended: the row is created so the trial starts and the
 * onboarding nudge can see them, and the account-setup wizard collects date of
 * birth, sex and sport afterwards.
 */

export type SignupMetadata = {
  first_name?: unknown;
  last_name?: unknown;
  full_name?: unknown;
  name?: unknown;
  date_of_birth?: unknown;
  age?: unknown;
  sex?: unknown;
  primary_sport?: unknown;
  terms_accepted_at?: unknown;
  terms_version?: unknown;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The row to insert, derived from metadata alone. Pure, so it can be tested
 * without a database — which is the only way to check the OAuth shape, where
 * Google supplies `name` and Apple may supply nothing at all.
 */
export function profileRowFromMetadata(
  userId: string,
  email: string | null,
  meta: SignupMetadata,
): Record<string, unknown> {
  // Google sends `full_name` and `name`; our own form sends first/last already
  // split. Prefer the split fields, then derive from whichever blob turned up.
  const firstName =
    str(meta.first_name) ?? str(meta.full_name)?.split(/\s+/)[0] ?? str(meta.name)?.split(/\s+/)[0];
  const fromBlob = str(meta.full_name) ?? str(meta.name);
  const lastName =
    str(meta.last_name) ??
    (fromBlob && fromBlob.split(/\s+/).length > 1
      ? fromBlob.split(/\s+/).slice(1).join(" ")
      : null);

  return {
    id: userId,
    email,
    first_name: firstName ?? null,
    last_name: lastName,
    date_of_birth: str(meta.date_of_birth),
    age: num(meta.age),
    sex: str(meta.sex),
    primary_sport: str(meta.primary_sport),
    terms_accepted_at: str(meta.terms_accepted_at),
    terms_version: str(meta.terms_version),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Insert the profile row if this account does not have one yet.
 *
 * Returns what happened, so the caller can log it — never throws: a failure here
 * must not turn a successful email confirmation into an error page. The cost of
 * failing is a late trial start, and the athlete can still use the app.
 */
export async function ensureProfileFromSignup(
  supabase: SupabaseClient,
): Promise<"created" | "exists" | "no_user" | "failed"> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "no_user";

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (existing) return "exists";

  const row = profileRowFromMetadata(
    user.id,
    user.email ?? null,
    (user.user_metadata ?? {}) as SignupMetadata,
  );

  // insert, not upsert: the select above already decided this row is new, and an
  // upsert here would overwrite a profile written in the gap by onboarding.
  const { error } = await supabase.from("profiles").insert(row);
  if (error) {
    // 23505 = unique violation: onboarding created the row between the select and
    // this insert. That is the race working as intended, not a failure.
    if (error.code === "23505") return "exists";
    console.error("[signup] profile insert failed:", error.message);
    return "failed";
  }
  return "created";
}
