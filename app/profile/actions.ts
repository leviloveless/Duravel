"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ProfileSchema } from "@/lib/schemas";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export type ProfileState = { error: string | null };

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export async function saveProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
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
 * NOTE: once BILLING_ENABLED is on, also cancel any live Stripe subscription for
 * this user (call the Stripe API here) so deletion doesn't leave an orphaned
 * paid subscription. Not needed while billing is off.
 */
export async function deleteAccount(
  _prev: DeleteState,
  _formData: FormData,
): Promise<DeleteState> {
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

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { error: error.message };

  await supabase.auth.signOut();
  redirect("/login?deleted=1");
}
