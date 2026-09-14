import Link from "next/link";

/**
 * Global footer (2026-09-13).
 *
 * The app had none, which meant the Terms and Privacy pages existed but were
 * reachable only from the signup form. App Store review looks for a persistent,
 * in-app route to both — and the Refund Policy now has to be reachable too,
 * because the signup consent names all three and a consent to a document nobody
 * can find afterwards is not much of a consent.
 *
 * Hidden when printing: a printed program should not end in a nav block.
 */
const LEGAL = [
  { href: "/terms", label: "Terms of Use" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refunds", label: "Refund Policy" },
] as const;

const PRODUCT = [
  { href: "/science", label: "Science" },
  { href: "/pricing", label: "Pricing" },
  { href: "/tools/hyrox-lookup", label: "HYROX result lookup" },
] as const;

export default function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-zinc-200 print:hidden">
      <div className="tick-tape" aria-hidden="true" />
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-display text-lg font-bold tracking-wide uppercase">Duravel</span>
          <span className="text-xs text-zinc-500">
            Coach-level programs for hybrid and endurance athletes.
          </span>
        </div>

        <nav className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-10" aria-label="Footer">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
              Product
            </span>
            {PRODUCT.map((l) => (
              <Link key={l.href} href={l.href} className="text-zinc-600 hover:text-black">
                {l.label}
              </Link>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
              Legal
            </span>
            {LEGAL.map((l) => (
              <Link key={l.href} href={l.href} className="text-zinc-600 hover:text-black">
                {l.label}
              </Link>
            ))}
          </div>
        </nav>
      </div>
      <div className="mx-auto max-w-6xl px-6 pb-8 text-xs text-zinc-400">
        {/* ⚠️ ONE EXPRESSION, ON PURPOSE. Written as
            `&copy; {year} Duravel LLC.` followed by plain JSX text, the space
            between the expression and the text was dropped — twice, at two
            different boundaries, rendering "2026Duravel LLC" and then
            "LLC.Training". A single template literal has no boundary to lose. */}
        {`\u00A9 ${new Date().getFullYear()} Duravel LLC. Training carries inherent risk \u2014 Duravel is not a medical service and does not provide medical advice.`}
      </div>
    </footer>
  );
}
