"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { GenerationInputSchema, WeekTemplateSchema } from "@/lib/schemas";
import { hasTier } from "@/lib/subscription";
import { validateTemplate, templateIsBuildable } from "@/lib/engine/template-validate";
import { templateContextFor } from "@/lib/program/week-template";

export type SaveTemplateResult =
  | { ok: true; blocking: never[] }
  | { ok: false; error: string; blocking?: { code: string; message: string }[] };

/**
 * Save an athlete-authored training week onto a program (custom tier, Levi
 * 2026-09-08).
 *
 * ## Why the template lands on `input_snapshot` and not on `program_data`
 *
 * The snapshot is the program's BUILD INPUT — it is what `generateProgram`
 * re-reads on every generate and every Recalculate. Writing the template there
 * makes it a durable fact about how this program is built, so the athlete's week
 * survives a recalculate instead of being flattened by the next one. Writing it
 * onto the generated weeks instead would make it a decoration that the first
 * rebuild discards, which is exactly the bug the admin session editor has today.
 *
 * ## Three gates, in this order
 *
 *  1. **Ownership** — RLS would block a foreign program anyway; fail clearly.
 *  2. **Tier** — checked here AND in `/api/generate`. Here so the athlete gets a
 *     sentence instead of a failed generate; there because that is the endpoint
 *     that actually consumes the template, and a gate on the authoring page
 *     alone would let a lapsed subscriber's Recalculate keep honouring a
 *     template forever.
 *  3. **Buildable** — blocking issues refuse. Warnings do NOT: Levi's rule is
 *     that the engine warns and the athlete decides, so a week with three
 *     back-to-back hard days saves, and the program gets built exactly as asked.
 *
 * The program is left in `generating` with `program_data` cleared, so the normal
 * generate-trigger picks it up — the same handoff `updateProgramInputs` uses.
 */
export async function saveWeekTemplate(
  programId: string,
  template: unknown,
): Promise<SaveTemplateResult> {
  const parsed = WeekTemplateSchema.safeParse(template);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That week isn't valid." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  if (!(await hasTier("custom"))) {
    return {
      ok: false,
      error:
        "Designing your own week is part of the custom plan. Upgrade from the pricing page to use it.",
    };
  }

  const { data: program } = await supabase
    .from("programs")
    .select("id, user_id, input_snapshot, start_date")
    .eq("id", programId)
    .single();
  if (!program || program.user_id !== user.id) {
    return { ok: false, error: "Program not found" };
  }

  const input = GenerationInputSchema.safeParse(program.input_snapshot);
  if (!input.success) {
    return {
      ok: false,
      error: "This program's build inputs can't be read. Try Recalculate first.",
    };
  }

  const ctx = templateContextFor(input.data, program.start_date as string);
  const issues = validateTemplate(parsed.data, ctx);
  if (!templateIsBuildable(issues)) {
    return {
      ok: false,
      error: "This week can't be built as written.",
      blocking: issues
        .filter((i) => i.severity === "blocking")
        .map((i) => ({ code: i.code, message: i.message })),
    };
  }

  const { error } = await supabase
    .from("programs")
    .update({
      input_snapshot: { ...input.data, weekTemplate: parsed.data },
      program_data: null,
      status: "generating",
    })
    .eq("id", programId);
  if (error) return { ok: false, error: "Could not save your week. Please try again." };

  revalidatePath(`/program/${programId}`);
  revalidatePath(`/program/${programId}/week`);
  return { ok: true, blocking: [] };
}

/** Drop the template and go back to the engine's own weekly structure. */
export async function clearWeekTemplate(programId: string): Promise<SaveTemplateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: program } = await supabase
    .from("programs")
    .select("id, user_id, input_snapshot")
    .eq("id", programId)
    .single();
  if (!program || program.user_id !== user.id) return { ok: false, error: "Program not found" };

  const snapshot = { ...(program.input_snapshot as Record<string, unknown>) };
  delete snapshot.weekTemplate;

  const { error } = await supabase
    .from("programs")
    .update({ input_snapshot: snapshot, program_data: null, status: "generating" })
    .eq("id", programId);
  if (error) return { ok: false, error: "Could not clear your week. Please try again." };

  revalidatePath(`/program/${programId}`);
  revalidatePath(`/program/${programId}/week`);
  return { ok: true, blocking: [] };
}

/**
 * Amend the week from `fromWeek` onward, leaving everything before it alone.
 *
 * Levi's ask, in his words: *"the ability to add a new workout mid-program that
 * is incorporated into the following weeks."*
 *
 * ## Why this appends rather than overwrites
 *
 * The weeks already trained are facts. They are also the input to the long run's
 * trailing four-week maximum, so rewriting week 3 from week 9 would move a
 * ceiling that has already done its job — and the athlete would see a plan that
 * disagrees with the training they actually did. So the change is stored WITH
 * the week it starts from, and the engine resolves per week
 * (`templateForWeek`).
 *
 * The corollary is worth stating: a program can still be rebuilt from its
 * `input_snapshot` alone and come out identical, which is the property the whole
 * snapshot design rests on. An amendment is a build input, not a patch on top of
 * a build.
 *
 * ## Why it does not need a "rebuild only weeks N+" path
 *
 * It looks like it should, and that was the first design. It does not, because
 * the template history makes the rebuild deterministic: regenerating the whole
 * program from the amended snapshot reproduces weeks 1..N-1 exactly as they
 * were — they resolve to the same earlier template — and only N onward change.
 * A partial rebuild would be more code for the same output and one more way for
 * the skeleton and the program to disagree.
 */
export async function amendWeekTemplate(
  programId: string,
  fromWeek: number,
  template: unknown,
): Promise<SaveTemplateResult> {
  const parsed = WeekTemplateSchema.safeParse(template);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That week isn't valid." };
  }
  if (!Number.isInteger(fromWeek) || fromWeek < 1) {
    return { ok: false, error: "Pick the week this change starts from." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  if (!(await hasTier("custom"))) {
    return {
      ok: false,
      error:
        "Changing your week mid-program is part of the custom plan. Upgrade from the pricing page to use it.",
    };
  }

  const { data: program } = await supabase
    .from("programs")
    .select("id, user_id, input_snapshot, start_date, duration_weeks")
    .eq("id", programId)
    .single();
  if (!program || program.user_id !== user.id) return { ok: false, error: "Program not found" };

  const input = GenerationInputSchema.safeParse(program.input_snapshot);
  if (!input.success) {
    return {
      ok: false,
      error: "This program's build inputs can't be read. Try Recalculate first.",
    };
  }
  const weeks = (program.duration_weeks as number) ?? 0;
  if (weeks > 0 && fromWeek > weeks) {
    return { ok: false, error: `This program only runs to week ${weeks}.` };
  }

  const issues = validateTemplate(
    parsed.data,
    templateContextFor(input.data, program.start_date as string),
  );
  if (!templateIsBuildable(issues)) {
    return {
      ok: false,
      error: "This week can't be built as written.",
      blocking: issues
        .filter((i) => i.severity === "blocking")
        .map((i) => ({ code: i.code, message: i.message })),
    };
  }

  // One change per starting week — re-amending week 9 replaces week 9's entry
  // rather than stacking a second one behind it, so the history stays a
  // resolvable sequence instead of an append-only log with duplicates in it.
  const existing = (input.data.weekTemplateChanges ?? []).filter((c) => c.fromWeek !== fromWeek);
  const changes = [...existing, { fromWeek, template: parsed.data }].sort(
    (a, b) => a.fromWeek - b.fromWeek,
  );

  const { error } = await supabase
    .from("programs")
    .update({
      input_snapshot: { ...input.data, weekTemplateChanges: changes },
      program_data: null,
      status: "generating",
    })
    .eq("id", programId);
  if (error) return { ok: false, error: "Could not save the change. Please try again." };

  revalidatePath(`/program/${programId}`);
  revalidatePath(`/program/${programId}/week`);
  return { ok: true, blocking: [] };
}
