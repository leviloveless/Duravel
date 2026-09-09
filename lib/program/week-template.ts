/**
 * Pure helpers for the athlete-authored week (custom tier, Levi 2026-09-08).
 *
 * Separate from `app/program/[id]/week/actions.ts` because that file is
 * `"use server"`, and a server-action module may only export async functions —
 * a synchronous export there is a build error, not a lint warning.
 */

import { GenerationInputSchema, type WeekTemplate } from "@/lib/schemas";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { getSport } from "@/lib/engine/sports";
import type { TemplateContext } from "@/lib/engine/template-validate";

/**
 * The facts the validator needs about THIS program, drawn from the same place
 * the engine draws them.
 *
 * `peakMileage` is the interesting one: it is what the volume-doctrine warning
 * is measured against, and taking it from the built skeleton rather than from
 * `startMileage` is the difference between warning about the week the athlete
 * starts on and warning about the week they will actually have to run. Those
 * differ by half again over sixteen weeks, and it is the peak that hurts.
 */
export function templateContextFor(
  input: ReturnType<typeof GenerationInputSchema.parse>,
  startDate: string,
): TemplateContext {
  const cfg = getSport(input.sport);
  let peakMileage: number | undefined;
  try {
    const skeleton = buildSkeleton(toEngineInput(input, startDate));
    peakMileage = Math.max(...skeleton.weeks.map((w) => w.targetMileage));
  } catch {
    // A snapshot the engine cannot build from is a bigger problem than a missing
    // warning; fall back to no mileage context rather than failing the save.
    peakMileage = undefined;
  }
  return {
    trainingDays: input.profile.trainingDays,
    peakMileage,
    weeklyHours: input.profile.weeklyHours,
    runningExp: input.profile.runningExp,
    prescribesRunning: cfg.runFloor !== 0,
    prescribesHybrid: (cfg.sessionCounts?.hybrid ?? undefined) !== undefined,
  };
}

/** The template already stored on a program, if any. */
export function storedTemplate(inputSnapshot: unknown): WeekTemplate | null {
  const parsed = GenerationInputSchema.safeParse(inputSnapshot);
  return parsed.success ? (parsed.data.weekTemplate ?? null) : null;
}
