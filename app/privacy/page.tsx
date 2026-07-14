import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Duravel",
  description: "How Duravel collects, uses, and protects your data.",
};

// NOTE (for Levi): this is a solid starting draft, not legal advice. Before the
// App Store submission, replace the [bracketed] placeholders (legal entity name,
// support email, governing-law location) and have it reviewed by counsel.
const SUPPORT_EMAIL = "support@duravel.app"; // TODO: replace with your real support address
const ENTITY = "Duravel"; // TODO: replace with your legal entity name
const UPDATED = "July 14, 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-16 text-sm leading-relaxed text-zinc-700">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-zinc-900">Privacy Policy</h1>
        <p className="text-xs text-zinc-500">Last updated: {UPDATED}</p>
      </div>

      <p>
        This Privacy Policy explains how {ENTITY} (&quot;Duravel,&quot; &quot;we,&quot; &quot;us&quot;)
        collects, uses, and shares information when you use the Duravel web app and any related
        applications (the &quot;Service&quot;). By using the Service you agree to this policy.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Information we collect</h2>
      <p>
        <strong>Account information.</strong> Your email address and authentication details, used to
        create and secure your account.
      </p>
      <p>
        <strong>Training profile and inputs.</strong> Details you provide to build your programs —
        such as first name, age, body weight, experience levels, training days, race dates and goals,
        and optional performance benchmarks (e.g. run, erg, and strength numbers).
      </p>
      <p>
        <strong>Health-related metrics you choose to enter.</strong> Optional inputs such as
        biological sex, resting heart rate, heart-rate variability, maximum and threshold heart rate,
        session RPE, and logged workout details. You are never required to provide these; they are
        used only to personalize your training (heart-rate zones, readiness, and load management) and
        are stored with your account.
      </p>
      <p>
        <strong>Usage data.</strong> Basic technical and usage information (such as generation events
        and app interactions) needed to operate, secure, and improve the Service.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">How we use your information</h2>
      <p>
        We use your information to generate and adapt your individualized HYROX training programs, to
        operate and secure your account, to process payments, to provide support, and to improve the
        Service. We do not sell your personal information.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Service providers</h2>
      <p>
        We share information with a small number of processors solely to run the Service:{" "}
        <strong>Supabase</strong> (authentication and database hosting), <strong>Anthropic</strong>
        {" "}(AI model that generates your programs — your training inputs are sent to produce your
        plan), <strong>Stripe</strong> (payment processing; we never store full card details), and
        our hosting provider (<strong>Vercel</strong>). Each processes data on our behalf under its
        own terms and security commitments.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Data retention and deletion</h2>
      <p>
        We keep your information for as long as your account is active. You can permanently delete
        your account and all associated data at any time from your{" "}
        <Link href="/profile" className="underline">profile page</Link>; deletion removes your
        profile, programs, logs, check-ins, and related records.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Security</h2>
      <p>
        Access to your data is restricted to your own account through row-level security, and traffic
        is encrypted in transit. No method of storage or transmission is perfectly secure, but we
        take reasonable measures to protect your information.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Children</h2>
      <p>
        The Service is not directed to children under 13, and you must be at least 13 (or the age of
        majority where required) to use it. We do not knowingly collect information from children
        under 13.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Your choices</h2>
      <p>
        You can review and update your profile at any time, and delete your account to remove your
        data. Depending on where you live, you may have additional rights over your personal
        information; contact us to exercise them.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Changes to this policy</h2>
      <p>
        We may update this policy from time to time. Material changes will be reflected by updating
        the date above.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Contact</h2>
      <p>
        Questions about this policy or your data? Contact us at{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">{SUPPORT_EMAIL}</a>.
      </p>

      <p className="mt-4 text-xs text-zinc-400">
        <Link href="/terms" className="underline">Terms of Service</Link> ·{" "}
        <Link href="/dashboard" className="underline">Back to dashboard</Link>
      </p>
    </main>
  );
}
