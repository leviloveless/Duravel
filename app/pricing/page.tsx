import Link from "next/link";
import type { Metadata } from "next";
import { getSubscription, hasActiveSubscription } from "@/lib/subscription";
import PricingPlans from "./pricing-plans";

export const metadata: Metadata = {
  title: "Pricing — Duravel",
  description: "Unlimited AI-built HYROX programs that adapt to every session you log.",
};

export default async function PricingPage() {
  const [sub, active] = await Promise.all([getSubscription(), hasActiveSubscription()]);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Train smarter with Duravel</h1>
        <p className="mx-auto max-w-xl text-zinc-600">
          Unlimited, individualized HYROX programs that adapt to every session you log. Built on a
          real periodization engine — not a template.
        </p>
      </header>

      <PricingPlans hasSubscription={active} plan={sub?.plan ?? null} />

      <p className="text-center text-xs text-zinc-500">
        Prices in USD. Payments are processed securely by Stripe. Cancel anytime from your billing
        portal. <Link href="/dashboard" className="underline">Back to dashboard</Link>.
      </p>
    </main>
  );
}
