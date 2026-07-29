"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { ProfileSchema } from "@/lib/schemas";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export type ProfileState = { error: string | null };

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export async function saveProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const trainingDays = DAY_KEYS.filter((d) => formData.get(`day_${d}`) === "on");

  const parsed = ProfileSchema.safeParse({
    firstName: formData.get("firstName"),
    age: Number(formData.get("age")),
    bodyWeight: Number(formData.get("bodyWeight")),
    weightUnit: formData.get("weightUnit"),
    runningExp: formData.get("runningExp"),
    hybridExp: formData.get("hybridExp"),
    liftingExp: formData.get("liftingExp"),
    trainingClass: formData.get("trainingClass"),
    trainingDays,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    first_name: parsed.data.firstName,
    age: parsed.data.age,
    body_weight: parsed.data.bodyWeight,
    weight_unit: parsed.data.weightUnit,
    running_exp: parsed.data.runningExp,
    hybrid_exp: parsed.data.hybridExp,
    lifting_exp: parsed.data.liftingExp,
    training_class: parsed.data.trainingClass,
    training_days: parsed.data.trainingDays,
    updated_at: new Date().toISOString(),
  });

  if (error) return { error: error.message };

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export type HyroxSaveState = { error: string | null; saved: boolean };

/** The HYROX result fields stored on the profile (per-station + run/roxzone splits + race type). */
const HYROX_RESULT_FIELDS = [
  "hyroxSkiErg",
  "hyroxSledPush",
  "hyroxSledPull",
  "hyroxBurpeeBroadJump",
  "hyroxRow",
  "hyroxFarmersCarry",
  "hyroxSandbagLunge",
  "hyroxWallBalls",
  "hyroxRunTotal",
  "hyroxRoxzone",
  "hyroxRaceType",
] as const;

/**
 * Save the athlete's HYROX result (station splits + race type) onto their
 * profile's `benchmarks`, MERGING with any existing benchmarks so 5K / strength
 * entries are preserved. These then pre-fill every future program's onboarding.
 */
export async function saveHyroxResults(
  _prev: HyroxSaveState,
  formData: FormData,
): Promise<HyroxSaveState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in.", saved: false };

  const { data: existing } = await supabase
    .from("profiles")
    .select("benchmarks")
    .eq("id", user.id)
    .maybeSingle();
  if (!existing) {
    return {
      error: "Save your profile details first, then add your HYROX results.",
      saved: false,
    };
  }

  const current = ((existing as { benchmarks: Record<string, unknown> | null }).benchmarks ??
    {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  for (const f of HYROX_RESULT_FIELDS) {
    const raw = formData.get(f);
    const val = typeof raw === "string" ? raw.trim() : "";
    if (val) next[f] = val;
    else delete next[f];
  }

  const { error } = await supabase
    .from("profiles")
    .update({ benchmarks: next, updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { error: error.message, saved: false };

  revalidatePath("/profile");
  return { error: null, saved: true };
}

export type DeleteState = { error: string | null };

/**
 * Permanently delete the signed-in user's account (App Store Guideline 5.1.1(v):
 * apps with account creation must offer in-app account deletion).
 *
 * Removes the Supabase auth user via the service-role admin client; every owned
 * row is then removed by ON DELETE CASCADE (auth.users → profiles → programs →
 * races / workout_logs / adaptations / readiness_checkins, plus subscriptions).
 * Then signs the user out and returns to the login page.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (the same key the Stripe webhook uses). If it
 * isn't configured, the action fails cleanly rather than half-deleting anything.
 *
 * Also cancels the user's Stripe subscription (if any) before deletion, so a
 * removed account never leaves an orphaned subscription that keeps billing a
 * card. That step is best-effort: a Stripe error is logged but never blocks the
 * deletion. (The FK to auth.users also stops the webhook re-creating the row.)
 */
export async function deleteAccount(_prev: DeleteState, _formData: FormData): Promise<DeleteState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "Account deletion isn't available right now. Please contact support." };
  }

  // Cancel any Stripe subscription before removing the account, so deletion never
  // leaves an orphaned subscription that keeps billing a card. Best-effort: a
  // Stripe failure (or billing not configured) is logged, not fatal — we don't
  // want to trap a user who wants out.
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .eq("user_id", user.id)
    .maybeSingle();
  const subRow = sub as { stripe_subscription_id?: string | null; status?: string } | null;
  if (
    subRow?.stripe_subscription_id &&
    subRow.status &&
    !["canceled", "incomplete_expired"].includes(subRow.status)
  ) {
    try {
      await getStripe().subscriptions.cancel(subRow.stripe_subscription_id);
    } catch (e) {
      console.error(
        `[account] failed to cancel Stripe subscription ${subRow.stripe_subscription_id} for ${user.id}: ${
          e instanceof Error ? e.message : "unknown error"
        }`,
      );
    }
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { error: error.message };

  await supabase.auth.signOut();
  redirect("/login?deleted=1");
}
