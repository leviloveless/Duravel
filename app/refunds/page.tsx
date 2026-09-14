import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Refund Policy — Duravel",
  description: "When Duravel issues refunds for subscriptions.",
};

// NOTE (for Levi): a starting draft in the standard US consumer-SaaS shape, not
// legal advice — you are the lawyer. Two things are worth your eyes before this
// is relied on: California's Automatic Renewal Law has specific pre-checkout
// disclosure and cancellation-flow obligations that bite on a monthly plan sold
// to US consumers, and the Texas governing-law tie-in should match the Terms.
//
// ⚠️ SUPPORT_EMAIL carries the same doubt as /terms and /privacy: nobody has
// confirmed it receives mail, and this is now the THIRD page pointing at it.
const SUPPORT_EMAIL = "support@duravel.app"; // TODO(levi): confirm this is monitored
const ENTITY = "Duravel LLC";
const UPDATED = "September 13, 2026";
/** Days after the initial annual charge (and after each renewal) that we refund in full. */
const ANNUAL_WINDOW_DAYS = 14;

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-2 text-base font-semibold text-zinc-900">{children}</h2>;
}

export default function RefundsPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-16 text-sm leading-relaxed text-zinc-700">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-bold tracking-wide uppercase">Refund Policy</h1>
        <p className="text-xs text-zinc-500">Last updated: {UPDATED}</p>
      </div>
      <div className="tick-tape" aria-hidden="true" />

      <p>
        This Refund Policy explains when {ENTITY} (&quot;Duravel&quot;) issues refunds for
        subscriptions to the Duravel service. It forms part of our{" "}
        <Link href="/terms" className="underline">
          Terms of Use
        </Link>
        . Capitalised terms have the meaning given there.
      </p>

      <H>Free trial</H>
      <p>
        Every new account includes a 14-day free trial of the full service. We do not collect
        payment details to start the trial, and the trial does not convert to a paid subscription
        automatically. You will only be charged if you choose a plan and complete checkout.
      </p>

      <H>Subscriptions and billing</H>
      <p>
        Paid plans are billed in advance — monthly plans on the same day each month, annual plans on
        the same date each year — and renew automatically until cancelled. You can cancel at any
        time from your billing portal. Cancelling stops future charges; your access continues until
        the end of the period you have already paid for.
      </p>

      <H>Monthly plans</H>
      <p>
        Monthly subscriptions are non-refundable once a billing period has begun, except as
        described under &quot;When we will refund&quot; below or where a refund is required by
        applicable law. If you cancel mid-month you keep access for the remainder of that month and
        are not charged again.
      </p>

      <H>Annual plans</H>
      <p>
        If you cancel an annual subscription within {ANNUAL_WINDOW_DAYS} days of the initial charge,
        we will refund it in full. After {ANNUAL_WINDOW_DAYS} days, annual subscriptions are
        non-refundable and no pro-rated refund is issued for unused months, except as described
        below or where required by applicable law.
      </p>

      <H>Renewal charges</H>
      <p>
        We email a reminder before each annual renewal. If an annual plan renews and you contact us
        within {ANNUAL_WINDOW_DAYS} days of the renewal charge, having not used the service since
        that charge, we will refund the renewal in full.
      </p>

      <H>When we will refund</H>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        <li>
          <b>Duplicate or accidental charges.</b> Refunded in full, always.
        </li>
        <li>
          <b>Unauthorised charges.</b> Contact us and we will investigate and refund where the
          charge was not authorised by the account holder.
        </li>
        <li>
          <b>Extended outage.</b> If the service is materially unavailable for more than 72
          consecutive hours in a billing period, we will credit or refund that period on request.
        </li>
        <li>
          <b>Injury or medical circumstances.</b> If you are unable to train for an extended period,
          contact us — we will pause your subscription at no cost rather than charge you for months
          you cannot use.
        </li>
      </ul>

      <H>What is not refundable</H>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        <li>Periods in which you had access to the service but chose not to use it.</li>
        <li>
          Dissatisfaction with a generated program where you have not contacted support to have it
          adjusted. Programs are regenerated free of charge on request.
        </li>
        <li>Accounts terminated by us for breach of the Terms of Use.</li>
      </ul>

      <H>Where you subscribed matters</H>
      <p>
        Duravel subscriptions are purchased on our website and processed by Stripe, and this policy
        governs them. If in future we offer a subscription through Apple&rsquo;s in-app purchase
        system, Apple — not Duravel — would process that payment and handle refunds for it under its
        own policies, and we would say so at the point of purchase. We cannot refund a charge we did
        not take.
      </p>

      <H>How to request a refund</H>
      <p>
        Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
          {SUPPORT_EMAIL}
        </a>{" "}
        from the address on your account, with the date and amount of the charge. We respond within
        three business days and process approved refunds to the original payment method within ten
        business days, subject to your bank&rsquo;s timing.
      </p>

      <H>Changes</H>
      <p>
        We may update this policy. Changes apply to charges made after the updated policy is posted,
        and we will note the effective date above.
      </p>
    </main>
  );
}
