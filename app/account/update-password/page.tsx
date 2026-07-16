import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import UpdatePasswordForm from "./update-password-form";

export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-24">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      {user ? (
        <>
          <p className="text-sm text-zinc-600">Enter a new password for your Duravel account.</p>
          <UpdatePasswordForm />
        </>
      ) : (
        <>
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            This password reset link is invalid or has expired.
          </p>
          <Link href="/forgot-password" className="text-sm text-zinc-500 underline">
            Request a new reset link
          </Link>
        </>
      )}
    </main>
  );
}
