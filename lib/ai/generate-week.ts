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
import { env } from "@/lib/env";
import { getSport } from "@/lib/engine/sports";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";

/** Token usage for one mesocycle call, summed across any retry attempts. */
export interface ChunkUsage {
  inputTokens: number;
  outputTokens: number;
}

/** A generated chunk plus the tokens it cost (for cost tracking). */
export interface ChunkResult {
  chunk: AiChunk;
  usage: ChunkUsage;
}

/** Haiku model; overridable via env for pinning/upgrades. */
const MODEL = env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
const MAX_TOKENS = 8000;

// Per-request timeout, comfortably under the route's maxDuration (60s). Without
// it the SDK default is 10 min, so a single hung call would silently consume the
// whole function budget and leave the program stuck 'generating'. On timeout the
// SDK throws → our catch marks the program 'failed' (roadmap #1.8). We do our own
// content retry below, so keep the SDK's network retries low to bound latency.
const REQUEST_TIMEOUT_MS = 40_000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey, maxRetries: 1, timeout: REQUEST_TIMEOUT_MS });
  }
  return client;
}

/** Pull the first JSON object out of a model reply, tolerating stray prose or ```json fences. */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1]!.trim(); // safe: capture group 1 is present whenever the match succeeds
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
  adaptationContext?: string,
): Promise<ChunkResult> {
  const cfg = getSport(input.sport);
  const system = buildSystemPrompt(cfg);
  const user = buildUserPrompt(input, phase, weeks, adaptationContext, cfg);
  const anthropic = getClient();

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];

  // Accumulate across attempts so a retry's tokens are counted too.
  const usage: ChunkUsage = { inputTokens: 0, outputTokens: 0 };

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    });

    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // A truncated reply can't parse; surface it clearly rather than as an opaque
    // JSON error. With week-batched chunks this shouldn't happen, but if it does
    // the fix is fewer weeks per call (see MAX_WEEKS_PER_CALL) or a higher cap.
    if (response.stop_reason === "max_tokens") {
      const truncErr = new Error(
        `model response truncated at max_tokens=${MAX_TOKENS} (${weeks.length} weeks in this call) — reduce weeks per call`,
      );
      if (attempt === 1) {
        throw new Error(`Session generation failed for ${phase} mesocycle after retry: ${truncErr.message}`);
      }
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content: `Your previous reply was cut off before the JSON was complete. Reply again with ONLY the complete JSON object for the requested weeks, and keep each session concise so it fits.`,
      });
      continue;
    }

    try {
      return { chunk: parseChunk(text), usage };
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
