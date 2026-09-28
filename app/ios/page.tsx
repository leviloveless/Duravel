import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { iosDestination } from "@/lib/ios-link";
import WaitlistForm from "./waitlist-form";

export const metadata: Metadata = {
  title: "Duravel for iPhone",
  description: "Duravel on iPhone: your program offline, Apple Health workouts, and reminders.",
};
export const dynamic = "force-dynamic";

/** duravel.app/ios — the QR target on /setup. Rules: lib/ios-link.ts. */
export default async function IosPage() {
  const dest = iosDestination(env.IOS_APP_STORE_URL, env.IOS_TESTFLIGHT_URL);
  if (dest.kind === "app_store") redirect(dest.url);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-14">
      <div>
        <p className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
          Duravel for iPhone
        </p>
        <h1 className="font-display mt-1 text-4xl font-bold tracking-wide uppercase">
          {dest.kind === "testflight" ? "The beta is open" : "Coming to iPhone"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600">
          The app carries your program offline, reads your workouts from Apple Health, and sends the
          session reminder on the morning of. Everything else — building, logging and the weekly
          recalculation — already works on the web.
        </p>
      </div>

      <section className="border-line rounded-xl border bg-white p-5">
        {dest.kind === "testflight" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-700">
              Install Apple&apos;s TestFlight app, then open the invite on your iPhone.
            </p>
            <a
              href={dest.url}
              className="bg-accent hover:bg-accent-hi self-start rounded-md px-5 py-2.5 text-sm font-semibold text-white"
            >
              Join the TestFlight beta
            </a>
          </div>
        ) : (
          <WaitlistForm defaultEmail={user?.email ?? ""} />
        )}
      </section>

      <section className="flex flex-col gap-2 text-sm text-zinc-600">
        <h2 className="text-sm font-semibold text-zinc-900">
          Until then: put Duravel on your Home Screen
        </h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open duravel.app in Safari.</li>
          <li>Tap the Share button, then &ldquo;Add to Home Screen&rdquo;.</li>
          <li>It opens full-screen like an app, signed in.</li>
        </ol>
      </section>

      <Link
        href={user ? "/dashboard" : "/signup"}
        className="text-accent text-sm font-semibold underline"
      >
        {user ? "Back to your dashboard" : "Create your free account"}
      </Link>
    </main>
  );
}
