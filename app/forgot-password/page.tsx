import Link from "next/link";
import ForgotPasswordForm from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-24">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="text-sm text-zinc-600">
        Enter your email and we&apos;ll send you a link to choose a new password.
      </p>
      <ForgotPasswordForm />
      <Link href="/login" className="text-sm text-zinc-500 underline">
        Back to sign in
      </Link>
    </main>
  );
}
