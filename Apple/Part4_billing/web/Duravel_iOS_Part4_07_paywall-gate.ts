// Duravel iOS — Part 4: Paywall gating logic for the Capacitor webview
// -----------------------------------------------------------------------------
// The gate answers one question for any premium surface: "show content, or show
// the paywall?" It reads entitlement from Supabase (the single source of truth),
// NOT from StoreKit and NOT from Stripe directly. That's what makes web + iOS
// access identical and prevents double-charge in the normal UI.
//
// Key behaviors:
//   * Web subscribers (active Stripe entitlement) NEVER see the iOS paywall.
//   * Only native-iOS non-subscribers see the StoreKit paywall.
//   * Web (browser) non-subscribers keep the existing Stripe web checkout.
//   * Restore Purchases is always reachable from the paywall (App Store rule).
// -----------------------------------------------------------------------------

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  isNativeIOS,
  initIAP,
  getPlans,
  purchase,
  restorePurchases,
  onEntitlementChange,
  type DuravelPlans,
} from "./Duravel_iOS_Part4_06_capacitor-iap";

// Reuse the app's existing Supabase client if you have one; shown here standalone.
const supabase: SupabaseClient = createClient(
  "https://DURAVEL_PROJECT.supabase.co",
  "DURAVEL_PUBLIC_ANON_KEY",
);

export interface EntitlementState {
  hasPro: boolean;
  accessUntil: string | null;
  source: "stripe" | "apple" | null;
  plan: "monthly" | "annual" | null;
}

// -----------------------------------------------------------------------------
// 1. The one entitlement read. Calls the RLS-safe RPC from Part 4.4 — returns
//    the CALLER's unified entitlement, whatever provider granted it.
// -----------------------------------------------------------------------------
export async function getEntitlement(): Promise<EntitlementState> {
  const { data, error } = await supabase.rpc("my_entitlement");
  if (error || !data || data.length === 0) {
    return { hasPro: false, accessUntil: null, source: null, plan: null };
  }
  const row = data[0];
  return {
    hasPro: !!row.has_pro,
    accessUntil: row.access_until ?? null,
    source: row.active_source ?? null,
    plan: row.active_plan ?? null,
  };
}

// -----------------------------------------------------------------------------
// 2. The gate. Call before rendering any premium surface.
//    Returns a directive telling the UI what to do.
// -----------------------------------------------------------------------------
export type GateDirective =
  | { action: "allow" }                                   // entitled — render content
  | { action: "paywall_native"; plans: DuravelPlans }     // iOS non-sub — StoreKit paywall
  | { action: "paywall_web" };                            // browser non-sub — existing Stripe flow

export async function gate(supabaseUserId: string): Promise<GateDirective> {
  const ent = await getEntitlement();

  // Already paying (via EITHER Stripe or Apple) → always allow, never upsell.
  // This is the double-charge guard: a web Stripe subscriber opening the iOS app
  // is entitled here, so the native paywall is never offered to them.
  if (ent.hasPro) return { action: "allow" };

  if (isNativeIOS()) {
    await initIAP(supabaseUserId);     // bind purchase to this Duravel user
    const plans = await getPlans();    // localized prices from Apple
    return { action: "paywall_native", plans };
  }

  // Browser: keep the existing web checkout (Stripe). Unchanged from today.
  return { action: "paywall_web" };
}

// -----------------------------------------------------------------------------
// 3. Purchase handler for the native paywall UI. After a successful buy, we
//    briefly poll Supabase so the gate reflects the webhook-written entitlement
//    (the webview reads Supabase, not StoreKit, as the source of truth).
// -----------------------------------------------------------------------------
export async function buyPlan(
  plans: DuravelPlans,
  which: "monthly" | "annual",
): Promise<{ ok: boolean; cancelled?: boolean; message?: string }> {
  const pkg = which === "monthly" ? plans.monthly : plans.annual;
  if (!pkg) return { ok: false, message: "plan_unavailable" };

  const res = await purchase(pkg);
  if (res.cancelled) return { ok: false, cancelled: true };
  if (res.error) return { ok: false, message: res.error };

  // StoreKit says entitled; confirm Supabase caught up (webhook is usually <1-2s).
  const confirmed = await waitForEntitlement(6000);
  return { ok: confirmed || res.entitled };
}

// -----------------------------------------------------------------------------
// 4. Restore handler — wire to the mandatory "Restore Purchases" button.
// -----------------------------------------------------------------------------
export async function restore(): Promise<{ ok: boolean; message?: string }> {
  const res = await restorePurchases();
  if (res.error) return { ok: false, message: res.error };
  const confirmed = await waitForEntitlement(6000);
  return { ok: confirmed || res.entitled };
}

// -----------------------------------------------------------------------------
// 5. Keep the UI live if Apple changes entitlement while the app is open.
//    Call once after mounting the app; `onChange` should re-run your gate/route.
// -----------------------------------------------------------------------------
export async function watchEntitlement(onChange: () => void): Promise<void> {
  if (!isNativeIOS()) return;
  await onEntitlementChange(() => onChange());
}

// Poll Supabase until has_pro flips true or timeout. Handles the tiny window
// between StoreKit success and the webhook writing the entitlement row.
async function waitForEntitlement(timeoutMs: number): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const ent = await getEntitlement();
    if (ent.hasPro) return true;
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

/* -----------------------------------------------------------------------------
USAGE SKETCH (framework-agnostic; adapt to Duravel's web app router):

  const directive = await gate(currentUser.id);
  switch (directive.action) {
    case "allow":
      renderPremiumContent();
      break;
    case "paywall_native":
      renderNativePaywall({
        monthlyPrice: directive.plans.monthly?.product.priceString,  // "$19.99"
        annualPrice:  directive.plans.annual?.product.priceString,   // "$119.99"
        onBuyMonthly: () => buyPlan(directive.plans, "monthly").then(route),
        onBuyAnnual:  () => buyPlan(directive.plans, "annual").then(route),
        onRestore:    () => restore().then(route),                    // REQUIRED button
      });
      break;
    case "paywall_web":
      redirectToExistingStripeCheckout();   // unchanged web behavior
      break;
  }

  // once, at app mount:
  watchEntitlement(() => rerouteBasedOnGate());
----------------------------------------------------------------------------- */
