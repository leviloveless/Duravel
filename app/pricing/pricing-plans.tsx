"use client";

import { useState } from "react";

type Plan = "monthly" | "annual";

const PRICES: Record<Plan, { label: string; price: string; per: string; sub: string }> = {
  monthly: { label: "Monthly", price: "$19", per: "/month", sub: "billed monthly" },
  annual: { label: "Annual", price: "$149", per: "/year", sub: "under $12.50/mo — billed yearly" },
};

const FEATURES = [
  "Unlimited AI-generated HYROX programs",
  "Weekly adaptation from your logged sessions",
  "Personalized pacing & station race plans",
  "Readiness-based training adjustments",
  "Cancel anytime",
];

export default function PricingPlans({
  hasSubscription,
  plan,
}: {
  hasSubscription: boolean;
  plan: Plan | null;
}) {
  const [selected, setSelected] = useState<Plan>("annual");
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
      if (!res.ok || !data.url) throw new Error(data.error ?? "Something went wrong. Please try again.");
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
          {plan === "annual" ? "Annual plan" : "Monthly plan"} · active
        </span>
        <h2 className="text-xl font-semibold">You&apos;re subscribed</h2>
        <p className="text-sm text-zinc-600">
          Thanks for supporting Duravel. Manage your plan, payment method, or cancel anytime.
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
        {(["monthly", "annual"] as Plan[]).map((p) => (
          <button
            key={p}
            onClick={() => setSelected(p)}
            aria-pressed={selected === p}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
              selected === p ? "bg-black text-white" : "text-zinc-600 hover:text-black"
            }`}
          >
            {PRICES[p].label}
            {p === "annual" && (
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                  selected === p ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-800"
                }`}
              >
                Save 35%
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
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <span aria-hidden className="mt-0.5 text-emerald-600">✓</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={() => post("/api/stripe/checkout", { plan: selected })}
          disabled={pending}
          className="rounded-full bg-black px-6 py-3 text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
        >
          {pending ? "Redirecting…" : `Subscribe ${selected === "annual" ? "annually" : "monthly"}`}
        </button>
        {error && <p className="text-center text-sm text-red-600">{error}</p>}
        <p className="text-center text-xs text-zinc-400">Secure checkout via Stripe</p>
      </div>
    </div>
  );
}
