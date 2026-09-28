import Link from "next/link";
import { getEntitlement } from "@/lib/subscription";

/**
 * Free-trial status banner (monetization). Async server component: it renders
 * nothing when billing is off, when the user is subscribed, or when there's no
 * trial to show — so it's safe to drop anywhere with no prop wiring.
 *
 * The trial is CARDED (2026-09-20): whoever sees the countdown has already given
 * a card and will be charged when it ends. So the banner says exactly that and
 * links to where they can cancel. It used to tell a carded athlete they had
 * given no card, beside a Subscribe link — false, and the link sent someone who
 * already HAS a subscription back to checkout.
 */
export default async function TrialBanner() {
  const { reason, trialDaysLeft, trialEndsAt } = await getEntitlement();

  // Nothing to show: pre-launch, already paying, or no profile/trial yet.
  if (reason === "billing_off" || reason === "subscription") return null;
  if (reason === "none" && !trialEndsAt) return null;

  if (reason === "trial" && trialDaysLeft && trialDaysLeft > 0) {
    return (
      <div className="flex flex-col items-start gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-emerald-900">
          <span className="font-medium">Free trial:</span> {trialDaysLeft} day
          {trialDaysLeft === 1 ? "" : "s"} left. Your plan starts automatically when it ends
          {trialEndsAt ? ` (${formatTrialEnd(trialEndsAt)})` : ""} unless you cancel before then.
        </p>
        <Link
          href="/settings"
          className="shrink-0 text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950"
        >
          Manage or cancel
        </Link>
      </div>
    );
  }

  // Trial ended.
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-amber-900">
        <span className="font-medium">Your free trial has ended.</span> Subscribe to keep generating
        and adapting programs.
      </p>
      <Link
        href="/pricing"
        className="shrink-0 rounded-full bg-black px-4 py-1.5 text-sm text-white transition-colors hover:bg-zinc-800"
      >
        View plans
      </Link>
    </div>
  );
}

/** "Oct 5" — the date the trial converts. UTC, matching how Stripe stamps the period end. */
function formatTrialEnd(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
