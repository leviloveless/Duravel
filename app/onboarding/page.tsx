import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/queries";
import { hasTier } from "@/lib/subscription";
import OnboardingForm from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getCurrentProfile();
  // The week designer is a custom-tier feature. Everyone still SEES the step —
  // it carries a one-line offer for anyone without the plan (Levi, 2026-09-11)
  // — but only an entitled athlete gets a grid they can author.
  const hasCustomTier = await hasTier("custom");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Build your program</h1>
          <p className="text-sm text-zinc-500">
            A few questions about you and your goal. We&apos;ll periodize the rest.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="shrink-0 rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          Exit to dashboard
        </Link>
      </div>
      <OnboardingForm profile={profile} hasCustomTier={hasCustomTier} />
    </main>
  );
}
