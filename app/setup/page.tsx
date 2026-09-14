import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/queries";
import { getConnectionStatuses } from "@/lib/wearables/connections";
import SetupWizard from "./setup-wizard";

export const metadata: Metadata = {
  title: "Set up your account — Duravel",
  description: "Two minutes of setup makes your first program a lot more accurate.",
};

export default async function SetupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getCurrentProfile();
  // Never let a connection-store hiccup stop someone setting up their account —
  // the step is optional, and an empty list renders as "not connected".
  const connections = await getConnectionStatuses(user.id).catch(() => []);
  const connected = new Set(connections.filter((c) => c.connected).map((c) => c.provider));

  const benchmarks = (profile?.benchmarks ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof benchmarks[k] === "string" ? (benchmarks[k] as string) : "");
  const num = (k: string) => (typeof benchmarks[k] === "number" ? String(benchmarks[k]) : "");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <SetupWizard
        firstName={profile?.first_name ?? null}
        initial={{
          age: profile?.age != null ? String(profile.age) : "",
          bodyWeight: profile?.body_weight != null ? String(profile.body_weight) : "",
          weightUnit: profile?.weight_unit ?? "lbs",
          heightIn: profile?.height_in != null ? String(profile.height_in) : "",
          restingHr: profile?.resting_hr != null ? String(profile.resting_hr) : "",
          fiveKTime: str("fiveKTime"),
          mileTime: str("mileTime"),
          row2kTime: str("row2kTime"),
          ski2kTime: str("ski2kTime"),
          fiveRmSquat: num("fiveRmSquat"),
        }}
        hasHyroxSplits={typeof benchmarks.hyroxRunTotal === "string"}
        strava={connected.has("strava")}
        oura={connected.has("oura")}
      />
    </main>
  );
}
