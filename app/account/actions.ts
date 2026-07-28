"use server";

import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export type EmailState = { error: string | null; sent: boolean };
export type PasswordState = { error: string | null; done: boolean };

const EmailSchema = z.object({ email: z.string().email() });
const PasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

/**
 * Change the signed-in user's email. Supabase emails a confirmation link to the
 * new address (and, with Secure Email Change enabled, the current one too); the
 * address only changes once the link is clicked. /auth/confirm verifies the
 * email_change token exactly like the signup/recovery tokens.
 */
export async function changeEmail(_prev: EmailState, formData: FormData): Promise<EmailState> {
  const parsed = EmailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Enter a valid email address.", sent: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to change your email.", sent: false };
  if (user.email?.toLowerCase() === parsed.data.email.toLowerCase()) {
    return { error: "That is already your email address.", sent: false };
  }

  const { error } = await supabase.auth.updateUser(
    { email: parsed.data.email },
    { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/confirm?next=/profile` },
  );
  if (error) return { error: error.message, sent: false };

  return { error: null, sent: true };
}

/**
 * Set a new password for the signed-in user. A valid session is sufficient
 * (Supabase does not require the current password), so this is the in-app
 * counterpart to the reset-link flow in app/login/actions.ts.
 */
export async function changePassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const parsed = PasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", done: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to change your password.", done: false };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message, done: false };

  return { error: null, done: true };
}
