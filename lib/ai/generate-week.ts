/**
 * Session Generator — one Claude Haiku call per mesocycle chunk
 * (architecture-plan.md §5 step 3).
 *
 * Sends the philosophy system prompt + that mesocycle's skeleton, parses the
 * JSON reply, and validates it against AiChunkSchema. On a parse/validation
 * failure it retries ONCE with the error fed back to the model, then throws.
 */

import Anthropic from "@anthropic-ai/sdk";
import { AiChunkSchema, type AiChunk, type GenerationInput } from "@/lib/schemas";
import type { PhaseName, WeekSkeleton } from "@/lib/engine/types";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";

/** Haiku model; overridable via env for pinning/upgrades. */
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
const MAX_TOKENS = 8000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Pull the first JSON object out of a model reply, tolerating stray prose or ```json fences. */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(t.slice(start, end + 1));
}

/** Validate raw model output into an AiChunk, throwing a readable error on failure. */
export function parseChunk(text: string): AiChunk {
  const raw = extractJson(text);
  const result = AiChunkSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(`Schema validation failed: ${first?.path.join(".")} — ${first?.message}`);
  }
  return result.data;
}

/**
 * Generate the session content for one mesocycle (its weeks), with a single
 * retry on failure. Returns validated AiWeek content keyed by week number.
 */
export async function generateChunk(
  input: GenerationInput,
  phase: PhaseName,
  weeks: WeekSkeleton[],
): Promise<AiChunk> {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(input, phase, weeks);
  const anthropic = getClient();

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    try {
      return parseChunk(text);
    } catch (err) {
      if (attempt === 1) {
        throw new Error(`Session generation failed for ${phase} mesocycle after retry: ${(err as Error).message}`);
      }
      // Feed the assistant's bad reply + the error back for a corrected retry.
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content: `That response was invalid: ${(err as Error).message}. Reply again with ONLY the corrected JSON object, no prose or code fences.`,
      });
    }
  }

  // Unreachable — the loop either returns or throws.
  throw new Error(`Session generation failed for ${phase} mesocycle`);
}
