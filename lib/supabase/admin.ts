import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role Supabase client — bypasses RLS. SERVER ONLY.
 *
 * Used exclusively by the Stripe webhook to write the `subscriptions` table on
 * the user's behalf (that table has no write policy for the auth role, so users
 * can never grant themselves a subscription). Never expose the service-role key
 * to the browser and never import this into a Client Component.
 */
export function createAdminClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — required for Stripe webhook writes.",
    );
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
