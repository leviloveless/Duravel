"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Delete one of the signed-in user's programs (Tasks addition #4).
 * RLS scopes the delete to the caller's own rows; `races` cascade.
 */
export async function deleteProgram(formData: FormData): Promise<void> {
  const id = formData.get("programId");
  if (typeof id !== "string" || !id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("programs").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/dashboard");
}

/**
 * Rename one of the signed-in user's programs (Tasks addition #1).
 */
export async function renameProgram(formData: FormData): Promise<void> {
  const id = formData.get("programId");
  const raw = formData.get("name");
  const name = typeof raw === "string" ? raw.trim() : "";
  if (typeof id !== "string" || !id || !name) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("programs").update({ name }).eq("id", id).eq("user_id", user.id);
  revalidatePath("/dashboard");
}

/**
 * Make one of the signed-in athlete's programs the dashboard's active program
 * (2026-09-28). An empty id clears the choice and returns them to the automatic
 * pick. The program must be theirs and ready — read through RLS, so another
 * athlete's id finds nothing and nothing is saved.
 */
export async function setActiveProgram(formData: FormData): Promise<void> {
  const raw = formData.get("programId");
  const id = typeof raw === "string" ? raw.trim() : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  if (id) {
    const { data: program } = await supabase
      .from("programs")
      .select("id")
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("status", "ready")
      .maybeSingle();
    if (!program) return;
  }

  await supabase
    .from("profiles")
    .update({ active_program_id: id || null })
    .eq("id", user.id);
  revalidatePath("/dashboard");
}
