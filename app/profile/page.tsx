import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/queries";
import ProfileForm from "./profile-form";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getCurrentProfile();

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Your profile</h1>
      <p className="text-sm text-zinc-500">
        Update your basic details. Benchmarks, races, and scheduling live in each
        program&apos;s setup.
      </p>
      <ProfileForm profile={profile} />
    </main>
  );
}
