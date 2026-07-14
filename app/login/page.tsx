import LoginForm from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ checkEmail?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-24">
      <h1 className="text-2xl font-semibold">Duravel</h1>
      {params.error && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Something went wrong confirming your email. Try signing in, or sign up again.
        </p>
      )}
      <LoginForm checkEmail={params.checkEmail === "1"} />
    </main>
  );
}
