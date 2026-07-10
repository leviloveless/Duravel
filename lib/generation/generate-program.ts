/**
 * Generation orchestrator (architecture-plan.md §5, the critical path).
 *
 * Loads a program's stored engine skeleton + input snapshot, fans out one
 * Haiku call per mesocycle, assembles the results into the final program with
 * engine-computed summaries and guaranteed movement-pattern coverage, verifies
 * it, and persists program_data with status 'ready' (or 'failed' on error).
 *
 * The skeleton is produced at onboarding time (Milestone 4) and stored on the
 * program row, so this step never recomputes the periodization — it only fills
 * and assembles, which is also what per-week regeneration (phase 2) will reuse.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GenerationInputSchema,
  type AiChunk,
  type GenerationInput,
  type ProgramData,
} from "@/lib/schemas";
import type { PhaseName, ProgramSkeleton, WeekSkeleton } from "@/lib/engine/types";
import { generateChunk } from "@/lib/ai/generate-week";
import { assembleProgram, verifyProgram } from "./assemble";

export interface GenerateResult {
  ok: boolean;
  status: "ready" | "failed";
  issues: string[];
}

/** Split the skeleton weeks into contiguous same-phase mesocycle chunks. */
export function chunkByMesocycle(skeleton: ProgramSkeleton): { phase: PhaseName; weeks: WeekSkeleton[] }[] {
  const chunks: { phase: PhaseName; weeks: WeekSkeleton[] }[] = [];
  for (const week of skeleton.weeks) {
    const last = chunks[chunks.length - 1];
    if (last && last.phase === week.phase) last.weeks.push(week);
    else chunks.push({ phase: week.phase, weeks: [week] });
  }
  return chunks;
}

/**
 * Run the full generation pipeline for one program. Assumes the caller has
 * already authorized the user for this program row.
 */
export async function generateProgram(
  supabase: SupabaseClient,
  programId: string,
): Promise<GenerateResult> {
  const { data: row, error } = await supabase
    .from("programs")
    .select("id, status, skeleton, input_snapshot")
    .eq("id", programId)
    .single();

  if (error || !row) {
    return { ok: false, status: "failed", issues: [error?.message ?? "Program not found"] };
  }

  try {
    if (!row.skeleton) throw new Error("Program has no stored skeleton");
    const skeleton = row.skeleton as ProgramSkeleton;

    const parsedInput = GenerationInputSchema.safeParse(row.input_snapshot);
    if (!parsedInput.success) throw new Error("Stored input snapshot is invalid");
    const input: GenerationInput = parsedInput.data;

    // Fan out one Haiku call per mesocycle (independent given the skeleton).
    const chunkPlan = chunkByMesocycle(skeleton);
    const chunks: AiChunk[] = await Promise.all(
      chunkPlan.map((c) => generateChunk(input, c.phase, c.weeks)),
    );

    // Assemble (engine summaries + pattern patching) and verify.
    const { program, issues } = assembleProgram(skeleton, chunks);
    const verdict = verifyProgram(program);
    if (!verdict.ok) {
      throw new Error(`Verification failed: ${verdict.issues.join("; ")}`);
    }

    await persist(supabase, programId, program);
    return { ok: true, status: "ready", issues };
  } catch (err) {
    await supabase.from("programs").update({ status: "failed" }).eq("id", programId);
    return { ok: false, status: "failed", issues: [(err as Error).message] };
  }
}

async function persist(supabase: SupabaseClient, programId: string, program: ProgramData): Promise<void> {
  const { error } = await supabase
    .from("programs")
    .update({ program_data: program, status: "ready" })
    .eq("id", programId);
  if (error) throw new Error(`Failed to persist program: ${error.message}`);
}
