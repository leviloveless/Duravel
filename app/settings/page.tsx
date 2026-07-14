import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * Settings hub. A simple landing page that links to the individual settings
 * areas (profile, wearable connections, billing). Auth-gated like the rest.
 */
const SECTIONS = [
  {
    href: "/profile",
    title: "Profile",
    desc: "Your name, age, body weight, and training basics.",
  },
  {
    href: "/settings/connections",
    title: "Connections",
    desc: "Connect Strava and other wearables so your training syncs automatically.",
  },
  {
    href: "/pricing",
    title: "Billing & plan",
    desc: "Manage your subscription, payment method, or free trial.",
  },
];

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-zinc-500">Manage your profile, connections, and plan.</p>
      </div>

      <div className="flex flex-col gap-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 p-5 transition-colors hover:bg-zinc-50"
          >
            <span className="flex flex-col">
              <span className="font-medium">{s.title}</span>
              <span className="text-sm text-zinc-500">{s.desc}</span>
            </span>
            <span aria-hidden className="text-lg text-zinc-400">
              →
            </span>
          </Link>
        ))}
      </div>

      <Link href="/dashboard" className="text-sm underline">
        Back to dashboard
      </Link>
    </main>
  );
}
