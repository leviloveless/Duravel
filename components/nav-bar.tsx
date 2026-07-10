import Link from "next/link";

/**
 * Global top navigation bar (Tasks addition #6). Lets the user move between the
 * main pages from anywhere. Auth-gated pages redirect to /login when signed out.
 */
export default function NavBar() {
  return (
    <header className="border-b border-zinc-200 bg-white/90 backdrop-blur print:hidden">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          HyroxAI
        </Link>
        <div className="flex items-center gap-1 text-sm">
          <Link href="/dashboard" className="rounded-md px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-black">
            Dashboard
          </Link>
          <Link href="/onboarding" className="rounded-md px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-black">
            New program
          </Link>
          <Link href="/profile" className="rounded-md px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-black">
            Profile
          </Link>
        </div>
      </nav>
    </header>
  );
}
