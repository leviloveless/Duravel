import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { mfaSatisfied } from "@/lib/admin";
import { requireAdminIdentity } from "@/lib/admin-access";
import { Card, Eyebrow, fmtDateTime } from "../users/ui";
import { MfaEnroll, MfaVerify } from "./mfa-forms";

export const metadata: Metadata = {
  title: "Two-factor · Admin",
  robots: { index: false, follow: false },
};

export default async function AdminMfaPage() {
  await requireAdminIdentity();
  const supabase = await createClient();
  const [{ data: aal }, { data: factors }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  const verified = (factors?.all ?? []).filter(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );
  const done = mfaSatisfied(aal?.currentLevel);
  const first = verified[0];

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-6 py-16">
      <div>
        <Eyebrow>Admin</Eyebrow>
        <h1 className="font-display text-ink mt-1 text-3xl font-bold">Two-factor sign-in</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">
          The account admin can refund payments and delete accounts, so it asks for a code from your
          phone as well as your password.
        </p>
      </div>
      <Card title={done ? "You're verified" : first ? "Enter your code" : "Set up"}>
        {done ? (
          <div className="flex flex-col gap-3 text-sm text-zinc-700">
            <p>This session has passed two-factor.</p>
            {verified.map((f) => (
              <p key={f.id} className="text-xs text-zinc-500">
                {f.friendly_name ?? "Authenticator"} · added {fmtDateTime(f.created_at)}
              </p>
            ))}
            <Link href="/admin/users" className="text-accent underline">
              Go to accounts
            </Link>
          </div>
        ) : first ? (
          <MfaVerify factorId={first.id} />
        ) : (
          <MfaEnroll />
        )}
      </Card>
      <p className="text-xs leading-relaxed text-zinc-500">
        Lost your phone? Remove the old authenticator in Supabase — from your user under
        Authentication → Users, or by deleting your row in{" "}
        <span className="font-mono">auth.mfa_factors</span> in the SQL editor — then set up a new
        one here. Your athlete account is unaffected either way.
      </p>
    </main>
  );
}
