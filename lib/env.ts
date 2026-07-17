import { z } from "zod";

/**
 * Validated environment variables (roadmap #1.6).
 *
 * Parsing at import time turns a missing or malformed env var into an immediate,
 * clearly-labelled boot failure instead of an opaque error deep inside a request
 * or a silent `undefined` reaching the Supabase/Anthropic/Stripe SDKs.
 * NEXT_PUBLIC_* are inlined into the client bundle; server-only secrets are
 * required only when running on the server (window === undefined).
 *
 * IMPORTANT — build vs runtime: during `next build`, static page-data collection
 * evaluates this module in worker processes that don't always have the runtime
 * env populated (a Next 16 / turbopack build quirk that made production deploys
 * fail intermittently). The build doesn't need these runtime secrets to compile
 * the bundle, so during the build phase a missing/invalid var is a WARNING, not
 * a fatal throw. At real runtime (server request or client) validation is strict
 * and still throws — the fail-fast guarantee is preserved where it matters.
 */
const isServer = typeof window === "undefined";
// Next sets NEXT_PHASE to "phase-production-build" for the build process (and its
// static-collection workers), but not at runtime.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  ANTHROPIC_API_KEY: isServer
    ? z.string().min(1, "ANTHROPIC_API_KEY is required")
    : z.string().optional(),
  // Optional but recommended so signup confirmation + Stripe redirect links are absolute.
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  // Optional model pin/override for the generation calls.
  ANTHROPIC_MODEL: z.string().optional(),

  // --- Billing (Stripe). All optional so the app boots before billing is set
  //     up; the Stripe/admin clients throw a clear error if used while unset. ---
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_PRICE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ANNUAL: z.string().optional(),
  // Service-role key — SERVER ONLY; used by the Stripe webhook to bypass RLS.
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Set to "true" to enforce subscription gating on paid features.
  BILLING_ENABLED: z.string().optional(),

  // --- Wearables (Phase 1). All optional so the app boots before any integration
  //     is configured; the Connections UI shows "not configured" until keys are set. ---
  STRAVA_CLIENT_ID: z.string().optional(),
  STRAVA_CLIENT_SECRET: z.string().optional(),
  GARMIN_CLIENT_ID: z.string().optional(),
  GARMIN_CLIENT_SECRET: z.string().optional(),
  // --- Lifecycle email (Resend). All optional so the app boots before email is
  //     configured; sendEmail() no-ops while EMAIL_ENABLED is unset. ---
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  EMAIL_ENABLED: z.string().optional(),
  EMAIL_UNSUB_SECRET: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

const rawEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  STRIPE_PRICE_MONTHLY: process.env.STRIPE_PRICE_MONTHLY,
  STRIPE_PRICE_ANNUAL: process.env.STRIPE_PRICE_ANNUAL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  BILLING_ENABLED: process.env.BILLING_ENABLED,
  STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID,
  STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET,
  GARMIN_CLIENT_ID: process.env.GARMIN_CLIENT_ID,
  GARMIN_CLIENT_SECRET: process.env.GARMIN_CLIENT_SECRET,

  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
  EMAIL_FROM: process.env.EMAIL_FROM,
  EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO,
  EMAIL_ENABLED: process.env.EMAIL_ENABLED,
  EMAIL_UNSUB_SECRET: process.env.EMAIL_UNSUB_SECRET,
  CRON_SECRET: process.env.CRON_SECRET,
};

const parsed = EnvSchema.safeParse(rawEnv);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  const message = `Invalid environment configuration:\n${lines}`;
  if (isBuildPhase) {
    // Don't fail the production build over a runtime secret that's momentarily
    // unreadable in a static-collection worker; runtime re-validates and throws.
    console.warn(`[env] ${message}\n[env] Non-fatal during build; runtime will re-validate.`);
  } else {
    throw new Error(message);
  }
}

// At runtime the parse succeeds (vars are present) → validated data. During the
// build phase, if it didn't, fall back to the raw values (unused for compilation).
export const env = (parsed.success ? parsed.data : rawEnv) as z.infer<typeof EnvSchema>;
