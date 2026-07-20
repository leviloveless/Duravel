"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdmin } from "@/lib/admin";

/** Update the fundraiser (#19) — admin only, service role. */
export async function updateFundraiser(input: {
  title: string;
  tagline: string;
  donateUrl: string;
  goalCents: number;
  raisedCents: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };

  const goal = Number.isFinite(input.goalCents) ? Math.max(0, Math.round(input.goalCents)) : 0;
  const raised = Number.isFinite(input.raisedCents) ? Math.max(0, Math.round(input.raisedCents)) : 0;

  const db = createAdminClient();
  const { error } = await db
    .from("fundraiser")
    .update({
      title: input.title.trim().slice(0, 120) || "Race for Impact",
      tagline: input.tagline.trim().slice(0, 300) || null,
      donate_url: input.donateUrl.trim().slice(0, 500) || null,
      goal_cents: goal,
      raised_cents: raised,
      updated_at: new Date().toISOString(),
    })
    .eq("id", "main");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/impact");
  revalidatePath("/admin/impact");
  return { ok: true };
}
