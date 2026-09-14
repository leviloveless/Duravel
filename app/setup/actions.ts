"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Account setup (2026-09-13) — the five-step wizard at `/setup`.
 *
 * Every step saves on its own and every step is skippable, so the actions here
 * are deliberately PARTIAL: each writes only the fields its step collected and
 * leaves the rest of the row alone. A wizard that saves everything at the end
 * loses the work of anyone who closes the tab at step 3, and the athletes most
 * likely to close the tab are exactly the ones whose data we most want.
 *
 * ⚠️ These `update` calls never touch `trial_started_at`. The row already exists
 * by the time anyone reaches setup (signup created it), and an upsert here could
 * re-default that column and silently restart a trial.
 */

export type SetupState = { error: string | null; saved: boolean };

const ok: SetupState = { error: null, saved: true };

/** A number typed into a text box: blank means "leave it alone", not zero. */
const optionalNumber = (max: number) =>
  z
    .string()
    .trim()
    .transform((s) => (s === "" ? null : Number(s)))
    .refine(
      (n) => n === null || (Number.isFinite(n) && n > 0 && n <= max),
      "Enter a realistic number.",
    );

const AboutSchema = z.object({
  bodyWeight: optionalNumber(600),
  weightUnit: z.enum(["lbs", "kg"]).optional(),
  heightIn: optionalNumber(96),
  restingHr: optionalNumber(120),
});

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function saveAbout(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const parsed = AboutSchema.safeParse({
    bodyWeight: formData.get("bodyWeight") ?? "",
    weightUnit: formData.get("weightUnit") ?? undefined,
    heightIn: formData.get("heightIn") ?? "",
    restingHr: formData.get("restingHr") ?? "",
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check those numbers.",
      saved: false,
    };
  }

  const userId = await currentUserId();
  if (!userId) return { error: "You must be signed in.", saved: false };

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.bodyWeight !== null) {
    row.body_weight = parsed.data.bodyWeight;
    // weight_unit is NOT NULL-free since 0046 but meaningless without a weight,
    // so it is only written alongside one.
    row.weight_unit = parsed.data.weightUnit ?? "lbs";
  }
  if (parsed.data.heightIn !== null) row.height_in = parsed.data.heightIn;
  if (parsed.data.restingHr !== null) row.resting_hr = parsed.data.restingHr;

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(row).eq("id", userId);
  if (error) return { error: error.message, saved: false };

  revalidatePath("/setup");
  return ok;
}

const BENCHMARK_FIELDS = ["fiveKTime", "mileTime", "row2kTime", "ski2kTime"] as const;

export async function saveBenchmarks(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const userId = await currentUserId();
  if (!userId) return { error: "You must be signed in.", saved: false };

  const supabase = await createClient();

  // Read-modify-write rather than replace: the HYROX result lookup may already
  // have written eight station splits into this column, and a blind overwrite
  // from four text boxes would delete them.
  const { data: existing } = await supabase
    .from("profiles")
    .select("benchmarks")
    .eq("id", userId)
    .maybeSingle();

  const benchmarks: Record<string, unknown> = {
    ...((existing?.benchmarks as Record<string, unknown> | null) ?? {}),
  };

  for (const f of BENCHMARK_FIELDS) {
    const raw = String(formData.get(f) ?? "").trim();
    if (raw !== "") benchmarks[f] = raw;
  }

  const squat = String(formData.get("fiveRmSquat") ?? "").trim();
  if (squat !== "") {
    const n = Number(squat);
    if (!Number.isFinite(n) || n <= 0 || n > 1000) {
      return { error: "Enter a realistic squat number, or leave it blank.", saved: false };
    }
    benchmarks.fiveRmSquat = n;
  }

  const { error } = await supabase
    .from("profiles")
    .update({ benchmarks, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { error: error.message, saved: false };

  revalidatePath("/setup");
  return ok;
}

/** Mark setup done (or dismissed) so it stops being offered. */
export async function finishSetup(): Promise<SetupState> {
  const userId = await currentUserId();
  if (!userId) return { error: "You must be signed in.", saved: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ setup_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { error: error.message, saved: false };

  revalidatePath("/", "layout");
  return ok;
}
