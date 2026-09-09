"use client";

import { useState } from "react";

// Mirrored rather than imported: this is a client component, and pulling the
// types in from `lib/subscription` would drag its server-only Supabase client
// into the bundle. Keep them in step with `lib/subscription.ts`.
type Plan = "monthly" | "annual";
type Tier = "standard" | "custom";

/**
 * What the athlete can buy.
 *
 * `custom_monthly` is a TIER, not an interval — the other two are the same
 * product billed differently. They share this list because they share a button;
 * the split back into `plan` and `tier` happens server-side from the Stripe
 * price id, in the webhook, which is the only place allowed to decide what
 * someone is entitled to.
 */
type Selection = Plan | "custom_monthly";

const PRICES: Record<Selection, { label: string; price: string; per: string; sub: string }> = {
  monthly: { label: "Monthly", price: "$19.99", per: "/month", sub: "billed monthly" },
  annual: { label: "Annual", price: "$119.99", per: "/year", sub: "about $10/mo — billed yearly" },
  custom_monthly: {
    label: "Custom",
    price: "$39.99",
    per: "/month",
    sub: "design your own week — billed monthly",
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
}: {
  hasSubscription: boolean;
  plan: Plan | null;
  tier?: Tier;
}) {
  const [selected, setSelected] = useState<Selection>("annual");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className="mx-auto inline-flex rounded-full border border-zinc-200 p-1">
        {(["monthly", "annual", "custom_monthly"] as Selection[]).map((p) => (
          <button
            key={p}
            onClick={() => setSelected(p)}
            aria-pressed={selected === p}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
              selected === p ? "bg-black text-white" : "text-zinc-600 hover:text-black"
            }`}
          >
            {PRICES[p].label}
            {p === "custom_monthly" && (
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                  selected === p ? "bg-white/20 text-white" : "bg-sky-100 text-sky-800"
                }`}
              >
                New
              </span>
            )}
            {p === "annual" && (
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                  selected === p ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-800"
                }`}
              >
                Save 50%
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-2xl border border-zinc-200 p-8">
        <div className="flex flex-col gap-1">
          <div className="flex items-end gap-1">
            <span className="text-4xl font-semibold">{PRICES[selected].price}</span>
            <span className="pb-1 text-sm text-zinc-500">{PRICES[selected].per}</span>
          </div>
          <span className="text-sm text-zinc-500">{PRICES[selected].sub}</span>
        </div>

        <ul className="flex flex-col gap-2 text-sm text-zinc-700">
          {(selected === "custom_monthly" ? CUSTOM_FEATURES : STANDARD_FEATURES).map((f) => (
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
          disabled={pending}
          className="rounded-full bg-black px-6 py-3 text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
        >
          {pending
            ? "Redirecting…"
            : selected === "custom_monthly"
              ? "Subscribe to Custom"
              : `Subscribe ${selected === "annual" ? "annually" : "monthly"}`}
        </button>
        {error && <p className="text-center text-sm text-red-600">{error}</p>}
        <p className="text-center text-xs text-zinc-400">Secure checkout via Stripe</p>
      </div>
    </div>
  );
}
