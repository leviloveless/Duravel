import { NextResponse } from "next/server";

/**
 * POST /api/generate
 * Runs the program generation pipeline (architecture-plan.md §5):
 *   1. Validate input (Zod)
 *   2. Periodization Engine (deterministic skeleton)
 *   3. AI session fill (Claude Haiku, chunked per mesocycle)
 *   4. Assemble + verify
 *   5. Persist to `programs` table
 *
 * Stub for Milestone 1 — implemented in Milestone 5.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Not implemented yet — see Milestone 5 in architecture-plan.md" },
    { status: 501 },
  );
}
