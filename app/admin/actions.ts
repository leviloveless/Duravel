"use server";

import { revalidatePath } from "next/cache";
import type { ProgramSkeleton } from "@/lib/engine/types";
import { syncSkeleton, syncSkeletonWeek } from "@/lib/program/skeleton-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdmin } from "@/lib/admin";
import { ProgramDataSchema, SessionSchema } from "@/lib/schemas";
import { weekMileage, weekCardioMinutes } from "@/lib/session-volume";
import { generateProgram } from "@/lib/generation/generate-program";

/**
 * Admin console server actions (#15) — every one gates on getAdmin() first, then
 * uses the service-role client to act across users. Reads/writes here bypass RLS
 * by design, so the getAdmin() check is the ONLY thing standing between these and
 * a full data breach — never remove it.
 */

export type AdminResult = { ok: true } | { ok: false; error: string };

/** Add a coaching note to a program (visible to the athlete). */
export async function addCoachingNote(programId: string, body: string): Promise<AdminResult> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };
  const text = body.trim();
  if (!text) return { ok: false, error: "Note is empty." };
  if (text.length > 4000) return { ok: false, error: "Note is too long (4000 max)." };

  const db = createAdminClient();
  const { data: program } = await db
    .from("programs")
    .select("user_id")
    .eq("id", programId)
    .maybeSingle();
  const ownerId = (program as { user_id?: string } | null)?.user_id;
  if (!ownerId) return { ok: false, error: "Program not found." };

  const { error } = await db.from("coaching_notes").insert({
    program_id: programId,
    user_id: ownerId,
    body: text,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/program/${programId}`);
  revalidatePath(`/program/${programId}`);
  return { ok: true };
}

/** Delete a coaching note. */
export async function deleteCoachingNote(noteId: string, programId: string): Promise<AdminResult> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };
  const db = createAdminClient();
  const { error } = await db.from("coaching_notes").delete().eq("id", noteId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/program/${programId}`);
  revalidatePath(`/program/${programId}`);
  return { ok: true };
}

/**
 * Replace a program's `program_data` with a hand-edited version. The JSON is
 * validated against the canonical ProgramDataSchema, so an admin can edit any
 * aspect of the plan but can never persist a shape that would break the app.
 */
export async function updateProgramData(programId: string, json: string): Promise<AdminResult> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
  const result = ProgramDataSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return { ok: false, error: `Schema error: ${first?.path.join(".")} — ${first?.message}` };
  }

  const db = createAdminClient();
  // Keep the SKELETON in step. Without this the edited program and the skeleton
  // disagree, and `adapt-week.ts` plans next week against the sessions the
  // skeleton still remembers rather than the ones the athlete can see.
  const { data: existing } = await db
    .from("programs")
    .select("skeleton")
    .eq("id", programId)
    .single();
  const skeleton = (existing as { skeleton?: ProgramSkeleton } | null)?.skeleton;
  const { error } = await db
    .from("programs")
    .update({
      program_data: result.data,
      status: "ready",
      ...(skeleton ? { skeleton: syncSkeleton(skeleton, result.data) } : {}),
    })
    .eq("id", programId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/program/${programId}`);
  revalidatePath(`/program/${programId}`);
  return { ok: true };
}

export type CoachSaveResult =
  { ok: true; totalMileage: number; totalCardioMinutes: number } | { ok: false; error: string };

/**
 * Save a single coach-edited session on the athlete's program and recompute that
 * week's running mileage + cardio minutes from the canonical session-volume math,
 * so the weekly totals shown to the athlete update to match the edit. zoneTargets
 * are the engine's phase targets and are left unchanged.
 */
export async function saveCoachSession(
  programId: string,
  weekNumber: number,
  day: string,
  sessionIndex: number,
  sessionJson: string,
): Promise<CoachSaveResult> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };

  let rawSession: unknown;
  try {
    rawSession = JSON.parse(sessionJson);
  } catch {
    return { ok: false, error: "Edited session is not valid JSON." };
  }
  const sess = SessionSchema.safeParse(rawSession);
  if (!sess.success) {
    const first = sess.error.issues[0];
    return { ok: false, error: `Session error: ${first?.path.join(".")} — ${first?.message}` };
  }

  const db = createAdminClient();
  const { data: row, error: selErr } = await db
    .from("programs")
    .select("program_data, skeleton")
    .eq("id", programId)
    .single();
  if (selErr || !row) return { ok: false, error: "Program not found." };

  const parsed = ProgramDataSchema.safeParse((row as { program_data?: unknown }).program_data);
  if (!parsed.success)
    return {
      ok: false,
      error: "Stored program failed validation — repair it in the JSON editor first.",
    };
  const data = parsed.data;

  const week = data.weeks.find((w) => w.weekNumber === weekNumber);
  if (!week) return { ok: false, error: `Week ${weekNumber} not found.` };
  const dayObj = week.days.find((d) => d.day === day);
  if (!dayObj || sessionIndex < 0 || sessionIndex >= dayObj.sessions.length) {
    return { ok: false, error: "Session not found." };
  }

  dayObj.sessions[sessionIndex] = sess.data;
  // Recompute the week's volume from the edited sessions (single source of truth).
  week.summary.totalMileage = weekMileage(week);
  week.summary.totalCardioMinutes = weekCardioMinutes(week);

  const check = ProgramDataSchema.safeParse(data);
  if (!check.success) {
    const first = check.error.issues[0];
    return { ok: false, error: `Schema error: ${first?.path.join(".")} — ${first?.message}` };
  }

  // ...and the skeleton with it, for the same reason as above: two stored views
  // of one week that disagree is how an adaptation ends up planned against a
  // session that is no longer on the calendar.
  const storedSkeleton = (row as { skeleton?: ProgramSkeleton }).skeleton;
  const { error } = await db
    .from("programs")
    .update({
      program_data: check.data,
      ...(storedSkeleton
        ? { skeleton: syncSkeletonWeek(storedSkeleton, check.data, weekNumber) }
        : {}),
    })
    .eq("id", programId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/program/${programId}`);
  revalidatePath(`/program/${programId}`);
  return {
    ok: true,
    totalMileage: week.summary.totalMileage,
    totalCardioMinutes: week.summary.totalCardioMinutes,
  };
}

/** Rename a program. */
export async function renameProgramAsAdmin(programId: string, name: string): Promise<AdminResult> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) return { ok: false, error: "Name is empty." };
  const db = createAdminClient();
  const { error } = await db.from("programs").update({ name: trimmed }).eq("id", programId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/program/${programId}`);
  return { ok: true };
}

/**
 * Recalculate a user's program on their behalf (re-runs the generation pipeline
 * via the service-role client, so it works for any owner and skips the per-user
 * rate limit that gates the athlete's own recalculate).
 */
export async function recalcProgramAsAdmin(programId: string): Promise<AdminResult> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };
  const db = createAdminClient();
  await db
    .from("programs")
    .update({ status: "generating", program_data: null })
    .eq("id", programId);
  try {
    const result = await generateProgram(db, programId);
    revalidatePath(`/admin/program/${programId}`);
    revalidatePath(`/program/${programId}`);
    if (!result.ok)
      return { ok: false, error: `Generation failed: ${result.issues?.join("; ") ?? "unknown"}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Generation error" };
  }
}

/** Approve or decline a coaching-waitlist application. */
export async function setWaitlistStatus(
  id: string,
  status: "applied" | "approved" | "declined",
): Promise<AdminResult> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };
  const db = createAdminClient();
  const { error } = await db
    .from("coaching_waitlist")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}
