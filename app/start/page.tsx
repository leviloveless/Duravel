import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/queries";

export const metadata: Metadata = {
  title: "Get started — Duravel",
  description: "Choose how you want your training built.",
};

/**
 * The route an athlete lands on straight after confirming their account.
 *
 * Three paths are shown and one works. That is deliberate: a single button would
 * say nothing about where the product is going, and hiding the other two would
 * make the same omission permanently. A disabled card with a reason on it is
 * also the cheapest possible demand signal — the coaching card has a real
 * waitlist behind it already, so it collects rather than just informing.
 */

type Path = {
  title: string;
  body: string;
  bullets?: readonly string[];
  cta: string;
  href?: string;
  flag: string;
  live: boolean;
};

const PATHS: readonly Path[] = [
  {
    title: "Build it with the engine",
    body: "Answer a few questions about your race, your week and your benchmarks. Duravel periodizes the whole block — mesocycles, deloads, taper and race week — then fills in the sessions.",
    bullets: [
      "HYROX, DEKA, triathlon, running, general fitness",
      "Re-plans every week from the sessions you log",
      "Takes about four minutes",
    ],
    cta: "Build my program",
    href: "/onboarding",
    flag: "Available now",
    live: true,
  },
  {
    title: "Start a prebuilt block",
    body: "Fixed 8- and 12-week HYROX and DEKA blocks you can start today without answering anything. Built for a first race, when you do not yet have benchmarks to build on.",
    cta: "Not open yet",
    flag: "Later",
    live: false,
  },
  {
    title: "Work with a coach",
    body: "A human coach reviews your engine-built week, edits it, and writes to you inside the app. Limited spots at launch.",
    cta: "Join the waitlist",
    href: "/coaching",
    flag: "Waitlist open",
    live: false,
  },
];

export default async function StartPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getCurrentProfile();

  return (
    <main className="flex flex-col">
      <header className="bg-brand px-6 py-12 text-center text-zinc-200">
        <p className="text-accent-hi font-mono text-[10px] tracking-[0.14em] uppercase">
          Step 2 of 3 · choose how you train
        </p>
        <h1 className="font-display mt-2 text-4xl font-bold tracking-wide text-white uppercase sm:text-5xl">
          {profile?.first_name ? `You're in, ${profile.first_name}.` : "You're in."}
        </h1>
        <p className="mx-auto mt-3 max-w-[54ch] text-zinc-400">
          Your 14-day trial is running. Pick how you want your training built — you can switch at
          any time.
        </p>
      </header>
      <div className="tick-tape tick-tape-invert bg-brand" aria-hidden="true" />

      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 px-6 py-10 lg:grid-cols-3">
        {PATHS.map((p) => (
          <article
            key={p.title}
            className={`relative flex flex-col gap-3 rounded-xl border p-6 ${
              p.live
                ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]"
                : "border-line bg-zinc-50"
            }`}
          >
            <span
              className={`absolute -top-2.5 right-4 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                p.live ? "bg-accent-wash text-accent" : "border-line border bg-white text-zinc-500"
              }`}
            >
              {p.flag}
            </span>

            <h2
              className={`font-display text-xl font-bold tracking-wide uppercase ${p.live ? "" : "text-zinc-500"}`}
            >
              {p.title}
            </h2>
            <p className={`flex-1 text-sm ${p.live ? "text-zinc-600" : "text-zinc-500"}`}>
              {p.body}
            </p>

            {p.bullets && (
              <ul className="flex flex-col gap-1.5 text-xs text-zinc-600">
                {p.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span aria-hidden className="text-accent">
                      ✓
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
            )}

            {p.href ? (
              <Link
                href={p.href}
                className={`rounded-md px-5 py-2.5 text-center text-sm font-semibold transition-colors ${
                  p.live
                    ? "bg-accent hover:bg-accent-hi text-white"
                    : "border-line-strong border text-zinc-700 hover:bg-white"
                }`}
              >
                {p.cta}
              </Link>
            ) : (
              <span className="border-line rounded-md border px-5 py-2.5 text-center text-sm font-semibold text-zinc-400">
                {p.cta}
              </span>
            )}
          </article>
        ))}
      </div>

      <p className="mx-auto max-w-6xl px-6 pb-12 text-center text-sm text-zinc-500">
        Not sure yet?{" "}
        <Link href="/setup" className="text-accent underline">
          Finish setting up your account
        </Link>{" "}
        first — it takes two minutes and makes the first program a lot more accurate.
      </p>
    </main>
  );
}
