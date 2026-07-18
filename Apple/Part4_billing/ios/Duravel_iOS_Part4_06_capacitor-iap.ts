// Duravel iOS — Part 4: Capacitor IAP client wiring
// -----------------------------------------------------------------------------
// Plugin: @revenuecat/purchases-capacitor  (official RevenueCat Capacitor plugin)
//   npm i @revenuecat/purchases-capacitor
//   npx cap sync ios
//
// Why this plugin: it wraps StoreKit 2 natively, does receipt validation via
// RevenueCat, exposes offerings (prices come from Apple, not hardcoded), and its
// webhooks feed Part 4.5. One SDK for buy + validate + restore.
//
// This module is the ONLY place the webview talks to StoreKit. Everything else
// (paywall gating) reads entitlement from Supabase — see Part 4.7.
//
// NOTE: These calls only work inside the native iOS shell. On plain web
// (app.duravel.app in a browser) the plugin is a no-op; guard with Capacitor
// platform checks so the same webview bundle runs both places. See `isNativeIOS`.
// -----------------------------------------------------------------------------

import { Capacitor } from "@capacitor/core";
import {
  Purchases,
  LOG_LEVEL,
  type PurchasesOffering,
  type PurchasesPackage,
  type CustomerInfo,
} from "@revenuecat/purchases-capacitor";

// Public RevenueCat API key (iOS). Safe to ship in the client — it's a public SDK key.
const RC_IOS_API_KEY = "appl_DURAVEL_PLACEHOLDER_PUBLIC_KEY";
const PRO_ENTITLEMENT = "pro"; // matches RC dashboard + Supabase entitlement_key

export function isNativeIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

// -----------------------------------------------------------------------------
// 1. Configure once at app start, and bind the purchase to the Duravel user.
//    Call after the user is authenticated in the webview (you already have the
//    Supabase session). Binding App User ID = Duravel user_id is what lets the
//    webhook (Part 4.5) attribute the purchase to the right account.
// -----------------------------------------------------------------------------
let configured = false;

export async function initIAP(supabaseUserId: string): Promise<void> {
  if (!isNativeIOS()) return; // web uses Stripe; nothing to do
  if (!configured) {
    await Purchases.setLogLevel({ level: LOG_LEVEL.WARN });
    await Purchases.configure({ apiKey: RC_IOS_API_KEY, appUserID: supabaseUserId });
    configured = true;
  } else {
    // Same session, user changed (e.g. re-login): re-identify.
    await Purchases.logIn({ appUserID: supabaseUserId });
  }
}

// Call on sign-out so a shared device doesn't leak entitlement between accounts.
export async function signOutIAP(): Promise<void> {
  if (!isNativeIOS() || !configured) return;
  await Purchases.logOut();
}

// -----------------------------------------------------------------------------
// 2. Fetch the offering (prices rendered by the paywall come from HERE, from
//    Apple — never hardcode $19.99/$119.99 in the UI).
// -----------------------------------------------------------------------------
export interface DuravelPlans {
  monthly?: PurchasesPackage; // localized price string in .product.priceString
  annual?: PurchasesPackage;
  offering?: PurchasesOffering;
}

export async function getPlans(): Promise<DuravelPlans> {
  if (!isNativeIOS()) return {};
  const { current } = (await Purchases.getOfferings()).all
    ? await Purchases.getOfferings()
    : ({ current: undefined } as any);
  const offering = current ?? undefined;
  return {
    offering,
    monthly: offering?.availablePackages.find(p => p.identifier === "$rc_monthly"),
    annual: offering?.availablePackages.find(p => p.identifier === "$rc_annual"),
  };
}

// -----------------------------------------------------------------------------
// 3. Purchase. Returns whether the user is now entitled. The native sheet (Face
//    ID / one-tap) is presented by the plugin. On success, RC fires the webhook
//    (Part 4.5) which writes the Supabase entitlement; we ALSO optimistically
//    trust customerInfo here so the UI unlocks instantly without waiting for the
//    round-trip.
// -----------------------------------------------------------------------------
export interface PurchaseResult {
  entitled: boolean;
  cancelled: boolean;
  error?: string;
}

export async function purchase(pkg: PurchasesPackage): Promise<PurchaseResult> {
  if (!isNativeIOS()) return { entitled: false, cancelled: false, error: "not_native" };
  try {
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
    return { entitled: hasPro(customerInfo), cancelled: false };
  } catch (e: any) {
    // RC surfaces user cancellation explicitly — don't treat it as an error.
    if (e?.code === "1" /* PURCHASE_CANCELLED */ || e?.userCancelled) {
      return { entitled: false, cancelled: true };
    }
    return { entitled: false, cancelled: false, error: e?.message ?? "purchase_failed" };
  }
}

// -----------------------------------------------------------------------------
// 4. Restore purchases — REQUIRED by App Store review for any non-consumable /
//    subscription. Wire this to a visible "Restore Purchases" button on the
//    paywall and in Settings. It re-associates the Apple account's active subs
//    with the current Duravel user via RC.
// -----------------------------------------------------------------------------
export async function restorePurchases(): Promise<PurchaseResult> {
  if (!isNativeIOS()) return { entitled: false, cancelled: false, error: "not_native" };
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    // RC also emits an event server-side; Supabase entitlement will be updated by
    // the webhook. Return the immediate result for UI.
    return { entitled: hasPro(customerInfo), cancelled: false };
  } catch (e: any) {
    return { entitled: false, cancelled: false, error: e?.message ?? "restore_failed" };
  }
}

// -----------------------------------------------------------------------------
// 5. Live entitlement listener — Apple can change state (renew/expire/refund)
//    while the app is open. Keep the UI honest.
// -----------------------------------------------------------------------------
export async function onEntitlementChange(cb: (entitled: boolean) => void): Promise<void> {
  if (!isNativeIOS()) return;
  await Purchases.addCustomerInfoUpdateListener((info: CustomerInfo) => cb(hasPro(info)));
}

function hasPro(info: CustomerInfo): boolean {
  return info?.entitlements?.active?.[PRO_ENTITLEMENT] !== undefined;
}
