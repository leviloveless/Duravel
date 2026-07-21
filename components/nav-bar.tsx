import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

/**
 * Global top navigation bar (Tasks addition #6; expanded for full-site nav).
 * Auth-aware: signed-in users get the app links (Dashboard, New program,
 * Activity, Settings) plus Science; signed-out users get the public marketing
 * links (Science, Tools, Coaching, Impact, Pricing) plus a Log in button.
 *
 * Desktop shows an inline row; on small screens the links collapse into a
 * pure-HTML <details> disclosure so this stays a server component (no client
 * JS). Sticky at the top so it's always visible on long program pages.
 */

const linkClass =
  "rounded-md px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-black";

/** Marketing pages shown to everyone. */
const PUBLIC_LINKS = [
  { href: "/science", label: "Science" },
  { href: "/tools", label: "Tools" },
  { href: "/coaching", label: "Coaching" },
  { href: "/impact", label: "Impact" },
  { href: "/pricing", label: "Pricing" },
] as const;

/** App pages shown once signed in. */
const APP_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/onboarding", label: "New program" },
  { href: "/activity", label: "Activity" },
  { href: "/science", label: "Science" },
  { href: "/settings", label: "Settings" },
] as const;

export default async function NavBar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const links = user ? APP_LINKS : PUBLIC_LINKS;

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/90 backdrop-blur print:hidden">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Duravel
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-1 text-sm md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass}>
              {l.label}
            </Link>
          ))}
          {user ? (
            <form action={signOut}>
              <button type="submit" className={linkClass}>
                Sign out
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-black px-4 py-1.5 text-white transition-colors hover:bg-zinc-800"
            >
              Log in
            </Link>
          )}
        </div>

        {/* Mobile disclosure (no client JS — native <details>) */}
        <details className="relative md:hidden">
          <summary className="flex cursor-pointer list-none items-center rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 [&::-webkit-details-marker]:hidden">
            Menu
          </summary>
          <div className="absolute right-0 mt-2 flex w-56 flex-col rounded-lg border border-zinc-200 bg-white p-1 text-sm shadow-lg">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={linkClass}>
                {l.label}
              </Link>
            ))}
            {user ? (
              <form action={signOut}>
                <button type="submit" className={`${linkClass} w-full text-left`}>
                  Sign out
                </button>
              </form>
            ) : (
              <Link href="/login" className={linkClass}>
                Log in
              </Link>
            )}
          </div>
        </details>
      </nav>
    </header>
  );
}
