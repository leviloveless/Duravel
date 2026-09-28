import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateEmailPreferences } from "./actions";

/**
 * Preference center (/settings/email). Server component — RLS user client reads the
 * caller's own email_preferences row (defaults all-on when no row exists yet). A plain
 * <form> + server action drives the update, so no client JS is needed.
 */
export const dynamic = "force-dynamic";

const CATEGORIES: { key: string; title: string; desc: string }[] = [
  {
    key: "onboarding",
    title: "Onboarding",
    desc: "Getting-started nudges while you set up your first plan.",
  },
  {
    key: "weekly_summary",
    title: "Weekly summary",
    desc: "Your week's training recap and what's next.",
  },
  {
    key: "race",
    title: "Race reminders",
    desc: "Countdowns and taper reminders for your goal race.",
  },
  { key: "milestone", title: "Milestones", desc: "Personal bests and progress milestones." },
  { key: "winback", title: "Win-back", desc: "Occasional check-ins if you drift away." },
  { key: "engagement", title: "Engagement", desc: "Tips and prompts to get more out of Duravel." },
  { key: "product", title: "Product updates", desc: "New features and improvements." },
];

type PrefRow = Record<string, boolean> & { unsubscribed_all?: boolean };

export default async function EmailPreferencesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("email_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const prefs = (data as PrefRow | null) ?? null;

  // Default all-on when there's no row yet.
  const isOn = (key: string): boolean => (prefs ? prefs[key] !== false : true);
  const unsubscribedAll = prefs?.unsubscribed_all === true;

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Email preferences</h1>
        <p className="text-sm text-zinc-500">
          Choose which lifecycle emails you want. Billing and receipt emails are always sent.
        </p>
      </div>

      <form action={updateEmailPreferences} className="flex flex-col gap-4">
        <div className="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          {CATEGORIES.map((c) => (
            <label
              key={c.key}
              className="flex cursor-pointer items-start justify-between gap-4 p-5"
            >
              <span className="flex flex-col">
                <span className="font-medium">{c.title}</span>
                <span className="text-sm text-zinc-500">{c.desc}</span>
              </span>
              <input
                type="checkbox"
                name={c.key}
                defaultChecked={isOn(c.key)}
                className="mt-1 h-5 w-5 shrink-0 accent-black"
              />
            </label>
          ))}
        </div>

        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-5">
          <span className="flex flex-col">
            <span className="font-medium">Unsubscribe from all lifecycle emails</span>
            <span className="text-sm text-zinc-500">
              Turns off every optional email above. You&apos;ll still get billing and receipts.
            </span>
          </span>
          <input
            type="checkbox"
            name="unsubscribed_all"
            defaultChecked={unsubscribedAll}
            className="mt-1 h-5 w-5 shrink-0 accent-black"
          />
        </label>

        <button
          type="submit"
          className="self-start rounded-full bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-zinc-800"
        >
          Save preferences
        </button>
      </form>

      <p className="text-xs text-zinc-400">
        Billing and account emails (receipts, trial reminders) are transactional and can&apos;t be
        turned off here.
      </p>

      <Link href="/settings" className="text-sm underline">
        Back to settings
      </Link>
    </main>
  );
}
