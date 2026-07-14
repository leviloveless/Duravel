import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Duravel",
  description: "The terms governing your use of Duravel.",
};

// NOTE (for Levi): a solid starting draft, not legal advice. Replace the
// [bracketed] placeholders and have counsel review before the App Store launch.
const SUPPORT_EMAIL = "support@duravel.app"; // TODO: replace with your real support address
const ENTITY = "Duravel"; // TODO: replace with your legal entity name
const GOVERNING_LAW = "[your state/country]"; // TODO: replace
const UPDATED = "July 14, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-16 text-sm leading-relaxed text-zinc-700">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-zinc-900">Terms of Service</h1>
        <p className="text-xs text-zinc-500">Last updated: {UPDATED}</p>
      </div>

      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of the Duravel web app and related
        applications (the &quot;Service&quot;), operated by {ENTITY}. By creating an account or using
        the Service, you agree to these Terms.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">The Service</h2>
      <p>
        Duravel generates individualized HYROX training programs and adapts them based on the
        information and session data you provide. Program content is produced with the help of
        automated systems and is provided for general fitness and informational purposes.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Not medical advice</h2>
      <p>
        Duravel is not a medical service and does not provide medical advice. The programs, paces,
        heart-rate zones, and recommendations are for general fitness purposes only and are not a
        substitute for professional medical guidance. Exercise carries inherent risks. Consult a
        qualified physician before beginning any training program, and stop and seek medical
        attention if you experience pain, dizziness, or other warning signs. You train at your own
        risk and are responsible for exercising within your own limits.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Accounts</h2>
      <p>
        You are responsible for the accuracy of the information you provide and for keeping your
        account credentials secure. You must be at least 13 years old (or the age of majority where
        required) to use the Service. You may delete your account at any time from your profile page.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Free trial, subscriptions, and billing</h2>
      <p>
        New accounts include a 14-day free trial with no payment card required. After the trial, an
        active paid subscription is required to continue generating and adapting programs.
        Subscriptions are billed through Stripe on a recurring basis (monthly or annually) at the
        prices shown on our pricing page, and renew automatically until cancelled. You can cancel at
        any time from your billing portal; cancellation stops future renewals and takes effect at the
        end of the current billing period. Except where required by law, payments are non-refundable.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Acceptable use</h2>
      <p>
        You agree not to misuse the Service, including attempting to disrupt or reverse-engineer it,
        access other users&apos; data, or use it for any unlawful purpose.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Intellectual property</h2>
      <p>
        The Service, including its software and content, is owned by {ENTITY} and protected by
        applicable laws. The training programs generated for you are provided for your personal,
        non-commercial use.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Disclaimers and limitation of liability</h2>
      <p>
        The Service is provided &quot;as is&quot; without warranties of any kind. To the maximum
        extent permitted by law, {ENTITY} is not liable for any indirect, incidental, or
        consequential damages, or for any injury arising from your use of the Service or the
        performance of any training activity.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Termination</h2>
      <p>
        You may stop using the Service and delete your account at any time. We may suspend or
        terminate access if these Terms are violated.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Changes</h2>
      <p>
        We may update these Terms from time to time. Continued use of the Service after changes take
        effect constitutes acceptance of the updated Terms.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Governing law</h2>
      <p>These Terms are governed by the laws of {GOVERNING_LAW}, without regard to conflict-of-law rules.</p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Contact</h2>
      <p>
        Questions about these Terms? Contact us at{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">{SUPPORT_EMAIL}</a>.
      </p>

      <p className="mt-4 text-xs text-zinc-400">
        <Link href="/privacy" className="underline">Privacy Policy</Link> ·{" "}
        <Link href="/dashboard" className="underline">Back to dashboard</Link>
      </p>
    </main>
  );
}
