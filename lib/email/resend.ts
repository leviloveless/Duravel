import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

/**
 * Singleton Resend client — SERVER ONLY. Mirrors how lib/supabase/admin and lib/stripe
 * gate on their keys: if RESEND_API_KEY is unset the client is null, so the app still
 * builds and runs with email effectively off.
 *
 * `emailEnabled()` is the runtime kill switch: it requires BOTH the flag EMAIL_ENABLED
 * === "true" AND a configured key, so merging every route/template with the flag off
 * deploys safely without sending a single email.
 */
const key = env.RESEND_API_KEY;

export const resend = key ? new Resend(key) : null;

export const EMAIL_FROM = env.EMAIL_FROM ?? "Duravel <coach@send.duravel.app>";
export const EMAIL_REPLY_TO = env.EMAIL_REPLY_TO ?? "levi.loveless@duravel.app";

export function emailEnabled(): boolean {
  return env.EMAIL_ENABLED === "true" && !!key;
}
