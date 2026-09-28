"use server";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/admin-access";
import { recordAdminAction } from "@/lib/admin-audit";
import {
  deleteConfirmationMatches,
  expiryFromDays,
  isSelfLockout,
  parseBulkDelete,
  parseNewAccount,
  summarizeBulkDelete,
  type BulkDeleteOutcome,
} from "@/lib/admin-account-rules";
import {
  cancelAllLive,
  cancelSubscription,
  customerIdsFor,
  endTrialNow,
  extendTrial,
  liveSubscriptionIds,
  refundCharge,
  resumeSubscription,
  stripeAdmin,
} from "@/lib/admin-billing";

/**
 * Every account-admin mutation.
 *
 * THE RULE FOR THIS FILE: each exported action calls `requireAdmin()` before it
 * reads a single field. A server action is a public POST endpoint — the page
 * that renders the form being admin-only protects nothing on its own.
 *
 * Writes use the SERVICE ROLE, because they change other people's rows and RLS
 * rightly lets no user JWT do that. Every change is written to
 * `admin_audit_log`.
 *
 * Results come back as `?ok=` / `?error=` on a redirect, so the page needs no
 * client JavaScript. `redirect()` works by throwing, so it is always called
 * OUTSIDE the try/catch that turns failures into messages.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function userIdFrom(form: FormData): string {
  const id = field(form, "userId");
  if (!UUID.test(id)) throw new Error("Invalid account id.");
  return id;
}

function back(userId: string, outcome: { ok?: string; error?: string }): never {
  const qs = outcome.error
    ? `error=${encodeURIComponent(outcome.error)}`
    : `ok=${encodeURIComponent(outcome.ok ?? "saved")}`;
  redirect(`/admin/users/${userId}?${qs}`);
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function targetOf(userId: string): Promise<User> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) throw new Error("That account no longer exists.");
  return data.user;
}

function siteUrl(): string {
  return (env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
}

/** The account's recorded Stripe customer, from the column the webhook writes. */
async function recordedCustomer(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;
}

// ─── access ────────────────────────────────────────────────────────────────────

/** Grant, revoke, or return an account to the normal billing rules. */
export async function setAccess(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let userId = "";
  let outcome: { ok?: string; error?: string };
  try {
    userId = userIdFrom(form);
    const access = field(form, "access");
    if (access !== "default" && access !== "grant" && access !== "revoke")
      throw new Error("Unknown access mode.");
    if (access === "revoke" && isSelfLockout(actor.id, userId)) {
      throw new Error("You can't revoke your own access.");
    }
    const tierRaw = field(form, "tier");
    const tier = tierRaw === "custom" ? "custom" : "standard";
    const daysRaw = field(form, "days");
    const days = daysRaw === "" ? null : Number(daysRaw);
    const expires = access === "grant" ? expiryFromDays(days, Date.now()) : null;
    const note = field(form, "note") || null;

    const target = await targetOf(userId);
    const admin = createAdminClient();
    const { error } = await admin.from("entitlement_overrides").upsert(
      {
        user_id: userId,
        access,
        grant_tier: access === "grant" ? tier : null,
        grant_expires_at: expires,
        note,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    await recordAdminAction(
      admin,
      actor,
      { id: userId, email: target.email ?? null },
      `access.${access}`,
      {
        tier: access === "grant" ? tier : null,
        expires,
        note,
      },
    );
    outcome = { ok: `access_${access}` };
  } catch (err) {
    outcome = { error: message(err) };
  }
  if (!userId)
    redirect(`/admin/users?error=${encodeURIComponent(outcome.error ?? "Invalid request")}`);
  back(userId, outcome);
}

// ─── profile & account ─────────────────────────────────────────────────────────

/**
 * Edit the basics, creating the profile row if the account has none.
 *
 * A created row carries `trial_started_at` = the ACCOUNT's creation time, not the
 * column default of now(). Since 2026-09-20 that column no longer drives the
 * trial (Stripe does), but the onboarding-nudge email still reads it as "when
 * they signed up", and a repaired row should not tell it they joined today.
 */
export async function updateProfile(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let userId = "";
  let outcome: { ok?: string; error?: string };
  try {
    userId = userIdFrom(form);
    const target = await targetOf(userId);
    const admin = createAdminClient();
    const patch = {
      first_name: field(form, "first_name") || null,
      last_name: field(form, "last_name") || null,
      primary_sport: field(form, "primary_sport") || null,
      updated_at: new Date().toISOString(),
    };
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    const { error } = existing
      ? await admin.from("profiles").update(patch).eq("id", userId)
      : await admin.from("profiles").insert({
          id: userId,
          email: target.email ?? null,
          trial_started_at: target.created_at,
          ...patch,
        });
    if (error) throw new Error(error.message);
    await recordAdminAction(
      admin,
      actor,
      { id: userId, email: target.email ?? null },
      existing ? "profile.update" : "profile.create",
      patch,
    );
    outcome = { ok: existing ? "profile_saved" : "profile_created" };
  } catch (err) {
    outcome = { error: message(err) };
  }
  if (!userId)
    redirect(`/admin/users?error=${encodeURIComponent(outcome.error ?? "Invalid request")}`);
  back(userId, outcome);
}

/** Change the sign-in email. Marked confirmed: the administrator is vouching for it. */
export async function changeEmail(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let userId = "";
  let outcome: { ok?: string; error?: string };
  try {
    userId = userIdFrom(form);
    const email = field(form, "email").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("That doesn't look like an email address.");
    if (isSelfLockout(actor.id, userId))
      throw new Error("Change your own email from your account settings.");
    const target = await targetOf(userId);
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
    if (error) throw new Error(error.message);
    await admin.from("profiles").update({ email }).eq("id", userId);
    await recordAdminAction(admin, actor, { id: userId, email }, "account.email", {
      from: target.email,
      to: email,
    });
    outcome = { ok: "email_changed" };
  } catch (err) {
    outcome = { error: message(err) };
  }
  if (!userId)
    redirect(`/admin/users?error=${encodeURIComponent(outcome.error ?? "Invalid request")}`);
  back(userId, outcome);
}

export async function sendPasswordReset(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let userId = "";
  let outcome: { ok?: string; error?: string };
  try {
    userId = userIdFrom(form);
    const target = await targetOf(userId);
    if (!target.email) throw new Error("This account has no email address.");
    const admin = createAdminClient();
    const { error } = await admin.auth.resetPasswordForEmail(target.email, {
      redirectTo: `${siteUrl()}/auth/confirm?next=/account/update-password`,
    });
    if (error) throw new Error(error.message);
    await recordAdminAction(
      admin,
      actor,
      { id: userId, email: target.email },
      "account.password_reset_sent",
    );
    outcome = { ok: "reset_sent" };
  } catch (err) {
    outcome = { error: message(err) };
  }
  if (!userId)
    redirect(`/admin/users?error=${encodeURIComponent(outcome.error ?? "Invalid request")}`);
  back(userId, outcome);
}

/**
 * Create an account by hand (2026-09-28).
 *
 * Unlike an invite, the account exists — confirmed — the moment this returns, so
 * a comp can be attached to it straight away. The athlete still owns their
 * password: they either get the set-a-password email, or sign in with Google on
 * the same address, or use "Forgot password" later. The admin never sets or sees
 * one.
 *
 * ⚠️ An account made here has NOT been through /signup, so no date of birth and
 * no Terms acceptance is on file for it. The audit entry records that it was
 * made by hand, and by whom.
 */
export async function createAccount(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let newId = "";
  let error = "";
  let ok = "created";
  try {
    const input = parseNewAccount({
      email: field(form, "email"),
      firstName: field(form, "firstName"),
      lastName: field(form, "lastName"),
      onboarding: field(form, "onboarding"),
      access: field(form, "access"),
      tier: field(form, "tier"),
      days: field(form, "days"),
      note: field(form, "note"),
    });
    const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ") || undefined;
    const metadata = {
      ...(input.firstName ? { first_name: input.firstName } : {}),
      ...(input.lastName ? { last_name: input.lastName } : {}),
      ...(fullName ? { full_name: fullName } : {}),
      created_by_admin: true,
    };
    const admin = createAdminClient();

    if (input.onboarding === "invite") {
      const { data, error: inviteError } = await admin.auth.admin.inviteUserByEmail(input.email, {
        data: metadata,
        redirectTo: `${siteUrl()}/auth/confirm?next=/setup`,
      });
      if (inviteError || !data?.user) throw new Error(inviteError?.message ?? "Invite failed.");
      newId = data.user.id;
      ok = "created_invited";
    } else {
      const { data, error: createError } = await admin.auth.admin.createUser({
        email: input.email,
        email_confirm: true,
        user_metadata: metadata,
      });
      if (createError || !data?.user) {
        throw new Error(createError?.message ?? "Could not create the account.");
      }
      newId = data.user.id;
      if (input.onboarding === "set_password") {
        const { error: resetError } = await admin.auth.resetPasswordForEmail(input.email, {
          redirectTo: `${siteUrl()}/auth/confirm?next=/account/update-password`,
        });
        // The account exists either way; say so rather than failing the whole action.
        ok = resetError ? "created_no_email" : "created_reset_sent";
      }
    }

    if (input.comp) {
      const { error: compError } = await admin.from("entitlement_overrides").upsert(
        {
          user_id: newId,
          access: "grant",
          grant_tier: input.comp.tier,
          grant_expires_at: expiryFromDays(input.comp.days, Date.now()),
          note: input.note,
          updated_by: actor.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (compError) ok = "created_comp_failed";
    }

    await recordAdminAction(admin, actor, { id: newId, email: input.email }, "account.create", {
      onboarding: input.onboarding,
      comp: input.comp,
      note: input.note,
      signup_checks: "collected at first sign-in (/welcome)",
    });
  } catch (err) {
    error = message(err);
  }
  if (error || !newId) {
    redirect(
      `/admin/users/new?error=${encodeURIComponent(error || "Could not create the account.")}`,
    );
  }
  redirect(`/admin/users/${newId}?ok=${ok}`);
}

// ─── suspend & delete ─────────────────────────────────────────────────────────

const SUSPEND_FOR = "876000h"; // 100 years: Supabase has no "forever"; this is its idiom for it.

export async function setSuspended(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let userId = "";
  let outcome: { ok?: string; error?: string };
  try {
    userId = userIdFrom(form);
    const suspend = field(form, "suspend") === "true";
    if (suspend && isSelfLockout(actor.id, userId))
      throw new Error("You can't suspend your own account.");
    const target = await targetOf(userId);
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: suspend ? SUSPEND_FOR : "none",
    });
    if (error) throw new Error(error.message);
    await recordAdminAction(
      admin,
      actor,
      { id: userId, email: target.email ?? null },
      suspend ? "account.suspend" : "account.unsuspend",
    );
    outcome = { ok: suspend ? "suspended" : "unsuspended" };
  } catch (err) {
    outcome = { error: message(err) };
  }
  if (!userId)
    redirect(`/admin/users?error=${encodeURIComponent(outcome.error ?? "Invalid request")}`);
  back(userId, outcome);
}

/**
 * Permanently delete an account.
 *
 * Order is deliberate. Stripe first: if canceling their subscription fails, the
 * delete STOPS, because an account that is gone but still being charged is the
 * worst outcome available here. Then the audit entry, while the email is still
 * known. Then the auth user — every table keyed to it cascades.
 */
export async function deleteAccount(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let userId = "";
  let error = "";
  try {
    userId = userIdFrom(form);
    if (isSelfLockout(actor.id, userId))
      throw new Error("You can't delete your own account from here.");
    const target = await targetOf(userId);
    if (!deleteConfirmationMatches(field(form, "confirm"), target.email ?? null)) {
      throw new Error("Type the account's email exactly to confirm.");
    }
    const admin = createAdminClient();
    let canceled: string[] = [];
    const stripe = stripeAdmin();
    if (stripe) {
      const customers = await customerIdsFor(
        stripe,
        target.email ?? null,
        await recordedCustomer(admin, userId),
      );
      canceled = await cancelAllLive(stripe, customers);
    }
    await recordAdminAction(
      admin,
      actor,
      { id: userId, email: target.email ?? null },
      "account.delete",
      {
        canceled_subscriptions: canceled,
      },
    );
    const { error: delError } = await admin.auth.admin.deleteUser(userId);
    if (delError)
      throw new Error(`Stripe was canceled, but the account delete failed: ${delError.message}`);
  } catch (err) {
    error = message(err);
  }
  if (error) {
    if (userId) back(userId, { error });
    redirect(`/admin/users?error=${encodeURIComponent(error)}`);
  }
  redirect(`/admin/users?ok=deleted`);
}

/**
 * Delete several accounts at once, from the checkboxes on the Accounts list
 * (2026-09-28).
 *
 * Deliberately more cautious than the single delete, because it is one click
 * for many people: an account with a LIVE Stripe subscription (trialing, active,
 * past due …) is skipped, not canceled. Cancel it on the account's own page
 * first, or use the single delete there, which cancels and deletes in one step
 * after you type their email. Each account is handled on its own, so one
 * failure never stops the rest, and each is audited before it is deleted.
 */
export async function deleteAccounts(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let summary = "";
  let error = "";
  try {
    const raw = form.getAll("userId").filter((v): v is string => typeof v === "string");
    const { ids, skippedSelf } = parseBulkDelete(raw, field(form, "confirm"), actor.id);
    const admin = createAdminClient();
    const stripe = stripeAdmin();
    const outcomes: BulkDeleteOutcome[] = [];
    for (const id of ids) {
      let email: string | null = null;
      try {
        const target = await targetOf(id);
        email = target.email ?? null;
        if (stripe) {
          const customers = await customerIdsFor(stripe, email, await recordedCustomer(admin, id));
          const live = await liveSubscriptionIds(stripe, customers);
          if (live.length > 0) {
            outcomes.push({ email, result: "skipped", reason: "live Stripe subscription" });
            continue;
          }
        }
        await recordAdminAction(admin, actor, { id, email }, "account.delete", { bulk: true });
        const { error: delError } = await admin.auth.admin.deleteUser(id);
        if (delError) throw new Error(delError.message);
        outcomes.push({ email, result: "deleted" });
      } catch (err) {
        outcomes.push({ email, result: "skipped", reason: message(err) });
      }
    }
    summary = summarizeBulkDelete(outcomes, skippedSelf);
  } catch (err) {
    error = message(err);
  }
  if (error) redirect(`/admin/users?error=${encodeURIComponent(error)}`);
  redirect(`/admin/users?ok=bulk_deleted&detail=${encodeURIComponent(summary)}`);
}

// ─── programs ─────────────────────────────────────────────────────────────────

export async function deleteProgram(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let userId = "";
  let outcome: { ok?: string; error?: string };
  try {
    userId = userIdFrom(form);
    const programId = field(form, "programId");
    if (!UUID.test(programId)) throw new Error("Invalid program id.");
    const admin = createAdminClient();
    const { data: program } = await admin
      .from("programs")
      .select("id, user_id, name")
      .eq("id", programId)
      .maybeSingle();
    const row = program as { id: string; user_id: string; name: string | null } | null;
    if (!row || row.user_id !== userId)
      throw new Error("That program doesn't belong to this account.");
    const { error } = await admin.from("programs").delete().eq("id", programId);
    if (error) throw new Error(error.message);
    const target = await targetOf(userId);
    await recordAdminAction(
      admin,
      actor,
      { id: userId, email: target.email ?? null },
      "program.delete",
      {
        program_id: programId,
        name: row.name,
      },
    );
    outcome = { ok: "program_deleted" };
  } catch (err) {
    outcome = { error: message(err) };
  }
  if (!userId)
    redirect(`/admin/users?error=${encodeURIComponent(outcome.error ?? "Invalid request")}`);
  back(userId, outcome);
}

// ─── Stripe ───────────────────────────────────────────────────────────────────

async function stripeContext(userId: string) {
  const stripe = stripeAdmin();
  if (!stripe) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY).");
  const target = await targetOf(userId);
  const admin = createAdminClient();
  const customers = await customerIdsFor(
    stripe,
    target.email ?? null,
    await recordedCustomer(admin, userId),
  );
  return { stripe, target, admin, customers };
}

export async function stripeCancel(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let userId = "";
  let outcome: { ok?: string; error?: string };
  try {
    userId = userIdFrom(form);
    const subscriptionId = field(form, "subscriptionId");
    const when = field(form, "when") === "now" ? "now" : "period_end";
    const { stripe, target, admin, customers } = await stripeContext(userId);
    await cancelSubscription(stripe, customers, subscriptionId, when);
    await recordAdminAction(
      admin,
      actor,
      { id: userId, email: target.email ?? null },
      `stripe.cancel_${when}`,
      {
        subscription: subscriptionId,
      },
    );
    outcome = { ok: when === "now" ? "sub_canceled" : "sub_cancel_scheduled" };
  } catch (err) {
    outcome = { error: message(err) };
  }
  if (!userId)
    redirect(`/admin/users?error=${encodeURIComponent(outcome.error ?? "Invalid request")}`);
  back(userId, outcome);
}

export async function stripeResume(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let userId = "";
  let outcome: { ok?: string; error?: string };
  try {
    userId = userIdFrom(form);
    const subscriptionId = field(form, "subscriptionId");
    const { stripe, target, admin, customers } = await stripeContext(userId);
    await resumeSubscription(stripe, customers, subscriptionId);
    await recordAdminAction(
      admin,
      actor,
      { id: userId, email: target.email ?? null },
      "stripe.resume",
      {
        subscription: subscriptionId,
      },
    );
    outcome = { ok: "sub_resumed" };
  } catch (err) {
    outcome = { error: message(err) };
  }
  if (!userId)
    redirect(`/admin/users?error=${encodeURIComponent(outcome.error ?? "Invalid request")}`);
  back(userId, outcome);
}

export async function stripeRefund(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let userId = "";
  let outcome: { ok?: string; error?: string };
  try {
    userId = userIdFrom(form);
    const chargeId = field(form, "chargeId");
    const { stripe, target, admin, customers } = await stripeContext(userId);
    const refunded = await refundCharge(stripe, customers, chargeId);
    await recordAdminAction(
      admin,
      actor,
      { id: userId, email: target.email ?? null },
      "stripe.refund",
      {
        charge: chargeId,
        ...refunded,
      },
    );
    outcome = { ok: "refunded" };
  } catch (err) {
    outcome = { error: message(err) };
  }
  if (!userId)
    redirect(`/admin/users?error=${encodeURIComponent(outcome.error ?? "Invalid request")}`);
  back(userId, outcome);
}

// ─── Stripe trials ────────────────────────────────────────────────────────────

/** Move a carded trial's end — the card is charged at the new date instead. */
export async function stripeExtendTrial(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let userId = "";
  let outcome: { ok?: string; error?: string };
  try {
    userId = userIdFrom(form);
    const subscriptionId = field(form, "subscriptionId");
    const days = Number(field(form, "days"));
    if (!Number.isInteger(days) || days < 1 || days > 60)
      throw new Error("Enter 1–60 days from today.");
    const endsAt = Math.floor(Date.now() / 1000) + days * 86400;
    const { stripe, target, admin, customers } = await stripeContext(userId);
    await extendTrial(stripe, customers, subscriptionId, endsAt);
    await recordAdminAction(
      admin,
      actor,
      { id: userId, email: target.email ?? null },
      "stripe.trial_extend",
      {
        subscription: subscriptionId,
        trial_end: new Date(endsAt * 1000).toISOString(),
      },
    );
    outcome = { ok: "trial_extended" };
  } catch (err) {
    outcome = { error: message(err) };
  }
  if (!userId)
    redirect(`/admin/users?error=${encodeURIComponent(outcome.error ?? "Invalid request")}`);
  back(userId, outcome);
}

/** End a carded trial today. Stripe charges the card now. */
export async function stripeEndTrial(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let userId = "";
  let outcome: { ok?: string; error?: string };
  try {
    userId = userIdFrom(form);
    const subscriptionId = field(form, "subscriptionId");
    const { stripe, target, admin, customers } = await stripeContext(userId);
    await endTrialNow(stripe, customers, subscriptionId);
    await recordAdminAction(
      admin,
      actor,
      { id: userId, email: target.email ?? null },
      "stripe.trial_end_now",
      {
        subscription: subscriptionId,
      },
    );
    outcome = { ok: "trial_ended_now" };
  } catch (err) {
    outcome = { error: message(err) };
  }
  if (!userId)
    redirect(`/admin/users?error=${encodeURIComponent(outcome.error ?? "Invalid request")}`);
  back(userId, outcome);
}
