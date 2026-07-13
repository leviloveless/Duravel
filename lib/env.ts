import { z } from "zod";

/**
 * Validated environment variables (roadmap #1.6).
 *
 * Parsing at import time turns a missing or malformed env var into an immediate,
 * clearly-labelled boot failure instead of an opaque error deep inside a request
 * or a silent `undefined` reaching the Supabase/Anthropic SDKs. NEXT_PUBLIC_* are
 * inlined into the client bundle; ANTHROPIC_API_KEY is server-only, so it's
 * required only when running on the server (window === undefined).
 */
const isServer = typeof window === "undefined";

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  ANTHROPIC_API_KEY: isServer
    ? z.string().min(1, "ANTHROPIC_API_KEY is required")
    : z.string().optional(),
  // Optional but recommended so signup confirmation links are absolute.
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  // Optional model pin/override for the generation calls.
  ANTHROPIC_MODEL: z.string().optional(),
});

const parsed = EnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
});

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${lines}`);
}

export const env = parsed.data;
