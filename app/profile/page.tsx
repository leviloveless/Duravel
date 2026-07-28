import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/queries";
import ProfileForm from "./profile-form";
import AccountSecurity from "./account-security";
import DeleteAccount from "./delete-account";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getCurrentProfile();

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Your profile</h1>
        <p className="text-sm text-zinc-500">
          Your account details and training basics. Benchmarks, races, and scheduling live in each
          program&apos;s setup.
        </p>
      </div>

      <AccountSecurity email={user.email ?? ""} />

      <ProfileForm profile={profile} />

      <p className="text-xs text-zinc-400">
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        {" · "}
        <Link href="/terms" className="underline">
          Terms of Service
        </Link>
      </p>

      <DeleteAccount />
    </main>
  );
}
