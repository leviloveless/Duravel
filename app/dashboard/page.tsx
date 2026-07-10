import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/queries";
import { signOut } from "@/app/login/actions";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getCurrentProfile();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {profile ? `Welcome back, ${profile.first_name}` : "Your programs"}
        </h1>
        <form action={signOut}>
          <button type="submit" className="text-sm text-zinc-500 underline">
            Sign out
          </button>
        </form>
      </div>

      <Link
        href="/onboarding"
        className="self-start rounded-full bg-black px-6 py-3 text-white transition-colors hover:bg-zinc-800"
      >
        {profile ? "Build a new program" : "Build your program"}
      </Link>

      <p className="text-zinc-600">
        Your program list renders here — Milestone 6.
      </p>

      {profile && (
        <Link href="/profile" className="self-start text-sm underline">
          Edit profile
        </Link>
      )}
    </main>
  );
}
