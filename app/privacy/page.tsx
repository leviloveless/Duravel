import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Duravel",
  description: "How Duravel collects, uses, and protects your data.",
};

// NOTE (for Levi): this is a solid starting draft, not legal advice. Before the
// App Store submission, confirm the support email and governing-law location and
// have it reviewed by counsel.
const SUPPORT_EMAIL = "support@duravel.app"; // TODO: confirm this is monitored
const ENTITY = "Duravel LLC"; // Texas LLC, doing business as "Duravel"
const UPDATED = "July 18, 2026";

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
        <strong>Health-related metrics you provide or connect.</strong> Optional inputs such as
        biological sex, resting heart rate, heart-rate variability, maximum and threshold heart rate,
        session RPE, and logged workout details. Some of these may be entered by you directly, and
        some may be imported from a fitness service you choose to connect (see{" "}
        <em>Connected services &amp; wearables</em> below). You are never required to provide these;
        they are used only to personalize your training (heart-rate zones, readiness, and load
        management) and are stored with your account.
      </p>
      <p>
        <strong>Usage data.</strong> Basic technical and usage information (such as generation events
        and app interactions) needed to operate, secure, and improve the Service.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">How we use your information</h2>
      <p>
        We use your information to generate and adapt your individualized training programs, to
        operate and secure your account, to process payments, to provide support, and to improve the
        Service. We do not sell your personal information, and we do not use it for advertising.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Connected services &amp; wearables</h2>
      <p>
        Duravel lets you optionally connect third-party fitness services to import your training data.
        We currently support <strong>Strava</strong> and <strong>Garmin Connect</strong>, and, in our
        mobile app, <strong>Apple Health (HealthKit)</strong>. Connecting any of these is entirely your
        choice and is never required to use the Service.
      </p>
      <p>
        <strong>What we import.</strong> When you connect a service, we import{" "}
        <strong>activity data</strong> for your completed workouts (such as type, date, duration,
        distance, pace, and heart rate), which we match to your planned sessions to track adherence and
        adapt your future training. From <strong>Garmin Connect</strong> we may additionally import{" "}
        <strong>daily health metrics</strong> — heart-rate variability (HRV), sleep, and resting heart
        rate — which are used to compute a readiness score that personalizes your training load.
      </p>
      <p>
        <strong>Your explicit authorization.</strong> We access this data only after you explicitly
        authorize the connection through the provider&apos;s own secure authorization (OAuth), and only
        for the data types you grant. We request the minimum scopes needed, and you can choose to sync
        activities while keeping daily health-metric ingestion turned off.
      </p>
      <p>
        <strong>How we use it.</strong> Connected-service data is used solely to deliver and personalize
        your own training experience within Duravel. We do not sell it, we do not use it for
        advertising, and we do not share it with third parties other than the service providers listed
        below that operate the Service on our behalf.
      </p>
      <p>
        <strong>Disconnecting and deletion.</strong> You can disconnect any service at any time from
        your settings, which stops all future syncing and revokes our access at the provider. You may
        also delete previously imported data — including a dedicated option to delete health data
        imported from Garmin — and deleting your account removes all connected-service data along with
        the rest of your records.
      </p>
      <p>
        <strong>Garmin.</strong> Health and activity data obtained through the Garmin Connect Developer
        Program is handled in accordance with Garmin&apos;s requirements: it is never sold, never used
        for advertising, and never stored in third-party cloud services outside the processors named
        below. We honor Garmin deregistration and permission-change notifications by stopping ingestion
        and revoking access.
      </p>
      <p>
        <strong>Apple Health (HealthKit).</strong> In our iOS app, health data you allow us to read via
        HealthKit is used only to personalize your training; it is never used for advertising or
        marketing, is never sold, and is not shared with third parties for their own purposes,
        consistent with Apple&apos;s HealthKit requirements.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Service providers</h2>
      <p>
        We share information with a small number of processors solely to run the Service:{" "}
        <strong>Supabase</strong> (authentication and database hosting), <strong>Anthropic</strong>
        {" "}(AI model that generates your programs — your training inputs are sent to produce your
        plan), <strong>Stripe</strong> (payment processing; we never store full card details),{" "}
        <strong>Resend</strong> (transactional and account emails), and our hosting provider
        ({" "}<strong>Vercel</strong>). Each processes data on our behalf under its own terms and
        security commitments.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Data retention and deletion</h2>
      <p>
        We keep your information for as long as your account is active. You can permanently delete
        your account and all associated data at any time from your{" "}
        <Link href="/profile" className="underline">profile page</Link>; deletion removes your
        profile, programs, logs, check-ins, connected-service data, and related records.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Security</h2>
      <p>
        Access to your data is restricted to your own account through row-level security, and traffic
        is encrypted in transit. Access and refresh tokens for connected services are encrypted before
        storage. No method of storage or transmission is perfectly secure, but we take reasonable
        measures to protect your information.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Children</h2>
      <p>
        The Service is not directed to children under 13, and you must be at least 13 (or the age of
        majority where required) to use it. We do not knowingly collect information from children
        under 13.
      </p>

      <h2 className="mt-2 text-base font-semibold text-zinc-900">Your choices</h2>
      <p>
        You can review and update your profile at any time, disconnect any connected service, and
        delete your account to remove your data. Depending on where you live, you may have additional
        rights over your personal information; contact us to exercise them.
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
