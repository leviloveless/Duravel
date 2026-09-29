"use client";

import { useState } from "react";
import { TRIAL_DAYS } from "@/lib/billing-constants";
import { trialTerms } from "@/lib/billing-copy";

// Mirrored rather than imported: this is a client component, and pulling the
// types in from `lib/subscription` would drag its server-only Supabase client
// into the bundle. Keep them in step with `lib/subscription.ts`.
type Plan = "monthly" | "annual";
type Tier = "standard" | "custom";

/**
 * What the athlete can buy: a TIER (standard or custom) billed at an INTERVAL
 * (monthly or annual). Annual is 33% off twelve months on both tiers (Levi,
 * 2026-09-27). The tier and interval are picked separately here and sent as one
 * wire value naming the price; the split back into `plan` and `tier` happens
 * server-side from the Stripe price id, in the webhook, which is the only place
 * allowed to decide what someone is entitled to.
 */
type Selection = Plan | "custom_monthly" | "custom_annual";

function selectionFor(tier: Tier, interval: Plan): Selection {
  return tier === "custom"
    ? interval === "annual"
      ? "custom_annual"
      : "custom_monthly"
    : interval;
}

const PRICES: Record<Selection, { price: string; per: string; sub: string }> = {
  monthly: { price: "$19.99", per: "/month", sub: "billed monthly" },
  annual: { price: "$159.99", per: "/year", sub: "about $13.33/mo — billed yearly" },
  custom_monthly: { price: "$29.99", per: "/month", sub: "design your own week — billed monthly" },
  custom_annual: {
    price: "$239.99",
    per: "/year",
    sub: "design your own week — about $20/mo, billed yearly",
  },
};

const STANDARD_FEATURES = [
  "Unlimited AI-generated HYROX programs",
  "Weekly adaptation from your logged sessions",
  "Personalized pacing & station race plans",
  "Readiness-based training adjustments",
  "Cancel anytime",
];

/**
 * What the custom tier adds, in the order it matters.
 *
 * The first line is the feature; the second is the one that justifies the price
 * gap, and it is worth being literal about. Anyone can offer a blank grid. What
 * is hard — and what the engine has spent months learning how to do — is telling
 * an athlete that four runs for a 30-mile week means 7-mile runs, and why that
 * is the expensive way to buy volume.
 */
const CUSTOM_FEATURES = [
  "Everything in the standard plan",
  "Design your own training week, day by day",
  "The engine periodizes it — deloads, tapers and race week are still handled",
  "Warnings when your week fights a training rule, with the reason",
  "Add a workout mid-program and carry it into the weeks ahead",
  "Starting templates for aerobic base, aerobic capacity and threshold",
];

export default function PricingPlans({
  hasSubscription,
  plan,
  tier = "standard",
  customAvailable,
  trialEligible,
}: {
  hasSubscription: boolean;
  plan: Plan | null;
  tier?: Tier;
  /**
   * Whether each custom price actually exists yet, decided on the server (the
   * price ids are server-only). Required rather than defaulted, because either
   * default is a lie waiting to happen: defaulting to `true` re-creates the bug
   * this fixes, and defaulting to `false` would let a new caller hide a plan that
   * IS on sale and never find out.
   */
  customAvailable: { monthly: boolean; annual: boolean };
  /**
   * Whether checkout will attach the free trial — decided on the server by the
   * same `isTrialEligible` rule the checkout route uses, so the button can never
   * promise a trial that checkout won't give. Required for the same reason
   * `customAvailable` is.
   */
  trialEligible: boolean;
}) {
  const [tierPick, setTierPick] = useState<Tier>("standard");
  // Opens on Standard monthly — the default plan a trial rolls into (Levi, 2026-09-29).
  const [interval, setBilling] = useState<Plan>("monthly");
  const selected = selectionFor(tierPick, interval);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The custom tier is being SHOWN but cannot be bought.
   *
   * Showing it at all is the deliberate choice here, over dropping the tab
   * entirely. The tier is genuinely built — the feature ships, the entitlement
   * ladder knows about it, the engine periodizes an authored week — and the only
   * missing piece is a Stripe price object. Hiding it would make the page lie by
   * omission about a product that exists, and would remove the one visible thing
   * that keeps the unfinished setup from being forgotten. A "Soon" badge sitting
   * on the live pricing page is a standing reminder; a hidden tab is not.
   *
   * What it must not do is take money it cannot take. So the tab selects and the
   * feature list reads, and only the checkout button is inert. The previous
   * behaviour — an enabled button that produced a 500 and "Billing is not
   * configured" — was the worst of both: it advertised the plan AND broke.
   */
  const customPending = tierPick === "custom" && !customAvailable[interval];

  async function post(url: string, body?: unknown) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url)
        throw new Error(data.error ?? "Something went wrong. Please try again.");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPending(false);
    }
  }

  if (hasSubscription) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-zinc-200 p-8 text-center">
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
          {tier === "custom" ? "Custom plan" : plan === "annual" ? "Annual plan" : "Monthly plan"} ·
          active
        </span>
        <h2 className="text-xl font-semibold">You&apos;re subscribed</h2>
        <p className="text-sm text-zinc-600">
          {tier === "custom"
            ? "You can design your own training week and the engine will periodize it. Manage your plan, payment method, or cancel anytime."
            : "Thanks for supporting Duravel. Manage your plan, payment method, or cancel anytime."}
        </p>
        <button
          onClick={() => post("/api/stripe/portal")}
          disabled={pending}
          className="rounded-full bg-black px-6 py-3 text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
        >
          {pending ? "Opening…" : "Manage billing"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3">
        <div
          className="inline-flex rounded-full border border-zinc-200 p-1"
          role="group"
          aria-label="Plan"
        >
          {(["standard", "custom"] as Tier[]).map((t) => (
            <button
              key={t}
              onClick={() => setTierPick(t)}
              aria-pressed={tierPick === t}
              className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                tierPick === t ? "bg-black text-white" : "text-zinc-600 hover:text-black"
              }`}
            >
              {t === "standard" ? "Standard" : "Custom"}
              {t === "custom" && (
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                    tierPick === t ? "bg-white/20 text-white" : "bg-sky-100 text-sky-800"
                  }`}
                >
                  {customAvailable.monthly || customAvailable.annual ? "New" : "Soon"}
                </span>
              )}
            </button>
          ))}
        </div>
        <div
          className="inline-flex rounded-full border border-zinc-200 p-1"
          role="group"
          aria-label="Billing"
        >
          {(["monthly", "annual"] as Plan[]).map((p) => (
            <button
              key={p}
              onClick={() => setBilling(p)}
              aria-pressed={interval === p}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                interval === p ? "bg-black text-white" : "text-zinc-600 hover:text-black"
              }`}
            >
              {p === "monthly" ? "Monthly" : "Annual"}
              {p === "annual" && (
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                    interval === p ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  Save 33%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-2xl border border-zinc-200 p-8">
        <div className="flex flex-col gap-1">
          <div className="flex items-end gap-1">
            <span className="text-4xl font-semibold">{PRICES[selected].price}</span>
            <span className="pb-1 text-sm text-zinc-500">{PRICES[selected].per}</span>
          </div>
          <span className="text-sm text-zinc-500">
            {customPending
              ? "design your own week — not available to buy yet"
              : PRICES[selected].sub}
          </span>
        </div>

        {customPending && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <b>Coming soon.</b> The custom plan is built — we&apos;re finishing the billing setup
            for it. Everything below is what it will include when it opens. The standard monthly and
            annual plans are available now.
          </p>
        )}

        <ul className="flex flex-col gap-2 text-sm text-zinc-700">
          {(tierPick === "custom" ? CUSTOM_FEATURES : STANDARD_FEATURES).map((f) => (
            <li key={f} className="flex items-start gap-2">
              <span aria-hidden className="mt-0.5 text-emerald-600">
                ✓
              </span>
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={() => post("/api/stripe/checkout", { plan: selected })}
          disabled={pending || customPending}
          className="rounded-full bg-black px-6 py-3 text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
        >
          {customPending
            ? "Coming soon"
            : pending
              ? "Redirecting…"
              : trialEligible
                ? `Start your ${TRIAL_DAYS}-day free trial`
                : `Subscribe${tierPick === "custom" ? " to Custom" : ""} ${
                    interval === "annual" ? "annually" : "monthly"
                  }`}
        </button>
        {trialEligible && !customPending ? (
          // The material terms, stated before the card is asked for — not only on
          // Stripe's page after the click.
          <div className="rounded-xl bg-zinc-50 px-4 py-3 text-center text-sm leading-relaxed text-zinc-700">
            <p className="font-semibold text-zinc-900">
              Card required &middot; $0 today &middot; nothing charged for {TRIAL_DAYS} days
            </p>
            <p className="mt-1 text-xs text-zinc-600">{trialTerms(selected, TRIAL_DAYS)}</p>
          </div>
        ) : null}
        {error && <p className="text-center text-sm text-red-600">{error}</p>}
        <p className="text-center text-xs text-zinc-400">Secure checkout via Stripe</p>
      </div>
    </div>
  );
}
