import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve a user's email via the service-role admin client. auth.users is not readable
 * by the anon client, so recipient resolution MUST go through the admin client. The
 * client is untyped, so the address is Zod-parsed at this boundary. Returns null if the
 * user is missing or has no valid address (caller treats null as "skip: no_recipient").
 */
const RecipientSchema = z.object({ email: z.string().email() });

export async function resolveRecipient(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  const parsed = RecipientSchema.safeParse({ email: data.user.email });
  return parsed.success ? parsed.data.email : null;
}
