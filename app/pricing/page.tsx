import Link from "next/link";
import type { Metadata } from "next";
import { getSubscription, hasActiveSubscription } from "@/lib/subscription";
import { customTierIsPurchasable, pricesFromEnv } from "@/lib/stripe-prices";
import PricingPlans from "./pricing-plans";

export const metadata: Metadata = {
  title: "Pricing — Duravel",
  description: "Unlimited AI-built HYROX programs that adapt to every session you log.",
};

export default async function PricingPage() {
  const [sub, active] = await Promise.all([getSubscription(), hasActiveSubscription()]);

  // Whether the custom tier can be BOUGHT, decided here on the server because the
  // price ids are server-only and a client component must never be trusted to
  // work this out. The same predicate gates the checkout route, so the page and
  // the server cannot disagree about what is on sale.
  //
  // This reads the environment on every render rather than being baked in at
  // build time, which is the property that matters: setting
  // `STRIPE_PRICE_CUSTOM_MONTHLY` puts the plan on sale, with no second flag to
  // remember and no code change to forget.
  const customAvailable = customTierIsPurchasable(pricesFromEnv());

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Train smarter with Duravel</h1>
        <p className="mx-auto max-w-xl text-zinc-600">
          Unlimited, individualized HYROX programs that adapt to every session you log. Built on a
          real periodization engine — not a template.
        </p>
      </header>

      <PricingPlans
        hasSubscription={active}
        plan={sub?.plan ?? null}
        tier={sub?.tier ?? "standard"}
        customAvailable={customAvailable}
      />

      <p className="text-center text-xs text-zinc-500">
        Prices in USD. Payments are processed securely by Stripe. Cancel anytime from your billing
        portal.{" "}
        <Link href="/dashboard" className="underline">
          Back to dashboard
        </Link>
        .
      </p>
    </main>
  );
}
