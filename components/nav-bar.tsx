import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

/**
 * Global top navigation bar (Tasks addition #6). Lets the user move between the
 * main pages from anywhere. Auth-aware: signed-in users see the app links plus a
 * Sign out button; signed-out users see Pricing + a single Log in button. The
 * Log in button is hidden entirely once a user is authenticated (new-additions #1).
 */
export default async function NavBar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="border-b border-zinc-200 bg-white/90 backdrop-blur print:hidden">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Duravel
        </Link>
        <div className="flex items-center gap-1 text-sm">
          {user && (
            <>
              <Link href="/dashboard" className="rounded-md px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-black">
                Dashboard
              </Link>
              <Link href="/onboarding" className="rounded-md px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-black">
                New program
              </Link>
              <Link href="/profile" className="rounded-md px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-black">
                Profile
              </Link>
              <Link href="/pricing" className="rounded-md px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-black">
                Pricing
              </Link>
              <form action={signOut}>
                <button
                  type="submit"
                  className="rounded-md px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-black"
                >
                  Sign out
                </button>
              </form>
            </>
          )}
          {/* Log in button — shown only when signed out; it disappears once the
              user is authenticated (new-additions #1). */}
          {!user && (
            <>
              <Link href="/pricing" className="rounded-md px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-black">
                Pricing
              </Link>
              <Link
                href="/login"
                className="rounded-md bg-black px-4 py-1.5 text-white transition-colors hover:bg-zinc-800"
              >
                Log in
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
