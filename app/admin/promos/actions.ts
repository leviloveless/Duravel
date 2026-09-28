"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-access";
import { recordAdminAction } from "@/lib/admin-audit";
import { parsePromo } from "@/lib/admin-account-rules";
import { createPromo, setPromoActive } from "@/lib/admin-promos";

function f(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function createPromoCode(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let result: string;
  try {
    const parsed = parsePromo(
      {
        code: f(form, "code"),
        percentOff: f(form, "percent_off"),
        amountOff: f(form, "amount_off"),
        duration: f(form, "duration"),
        months: f(form, "months"),
        maxRedemptions: f(form, "max_redemptions"),
        expiresInDays: f(form, "expires_days"),
        firstTimeOnly: form.get("first_time_only") === "on",
      },
      Date.now(),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const created = await createPromo(parsed.plan);
    await recordAdminAction(createAdminClient(), actor, { id: null, email: null }, "promo.create", {
      ...parsed.plan,
      ...created,
    });
    result = "ok=promo_created";
  } catch (err) {
    result = `error=${encodeURIComponent(msg(err))}`;
  }
  redirect(`/admin/promos?${result}`);
}

export async function togglePromo(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  let result: string;
  try {
    const id = f(form, "promoId");
    if (!/^promo_[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid promotion code id.");
    const active = f(form, "active") === "true";
    const code = await setPromoActive(id, active);
    await recordAdminAction(
      createAdminClient(),
      actor,
      { id: null, email: null },
      active ? "promo.activate" : "promo.deactivate",
      {
        promo: id,
        code,
      },
    );
    result = active ? "ok=promo_on" : "ok=promo_off";
  } catch (err) {
    result = `error=${encodeURIComponent(msg(err))}`;
  }
  redirect(`/admin/promos?${result}`);
}
