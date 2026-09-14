import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignUpForm from "./signup-form";

export const metadata: Metadata = {
  title: "Create your athlete account — Duravel",
  description: "14 days of Duravel, free. No card required.",
};

const PROOF = [
  {
    k: "01",
    t: "Your week is legal by construction — deloads, taper and sled-day spacing are enforced, not suggested.",
  },
  {
    k: "02",
    t: "Paces and heart-rate zones are computed from your benchmarks, then held to the exact minute.",
  },
  { k: "03", t: "Log a session and next week reshapes around what you actually did." },
] as const;

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const params = await searchParams;
  // Set by the OAuth actions when a provider is not configured in Supabase, so
  // the button fails with a sentence instead of a blank redirect.
  const providerError =
    params.error === "google" || params.error === "apple"
      ? `We couldn't reach ${params.error === "google" ? "Google" : "Apple"} just now. Create your account with an email address instead.`
      : null;

  return (
    <main className="mx-auto grid max-w-6xl grid-cols-1 gap-0 px-0 lg:grid-cols-2">
      <aside className="bg-brand flex flex-col gap-7 px-8 py-10 text-zinc-200 lg:px-10 lg:py-14">
        <span className="font-display text-2xl font-bold tracking-wider uppercase">
          Dura<span className="text-accent-hi">vel</span>
        </span>

        <div className="flex flex-col gap-4">
          <h1 className="font-display text-4xl leading-none font-bold tracking-wide text-white uppercase lg:text-5xl">
            Built by an engine.
            <br />
            <span className="text-accent-hi">Not a template.</span>
          </h1>
          <p className="max-w-[38ch] text-zinc-400">
            Every Duravel program is periodized in code — volume, sequencing and race week are
            decided before a single word is written.
          </p>
        </div>

        <div className="tick-tape tick-tape-invert mt-auto" aria-hidden="true" />

        <ul className="flex flex-col gap-3">
          {PROOF.map((p) => (
            <li key={p.k} className="flex gap-3 text-sm text-zinc-300">
              <span className="text-accent-hi w-6 shrink-0 pt-0.5 font-mono text-xs">{p.k}</span>
              <span>{p.t}</span>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex flex-col gap-5 px-6 py-10 lg:px-10 lg:py-14">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-3xl font-bold tracking-wide uppercase">
            Create your athlete account
          </h2>
          <p className="text-sm text-zinc-500">14 days of everything, free. No card required.</p>
        </div>

        {providerError && (
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{providerError}</p>
        )}

        <SignUpForm />

        <p className="text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <Link href="/login" className="text-accent underline">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
