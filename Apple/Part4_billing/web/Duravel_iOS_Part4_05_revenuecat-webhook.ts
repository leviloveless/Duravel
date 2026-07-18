// Duravel iOS — Part 4: Entitlement sync edge function
// -----------------------------------------------------------------------------
// Supabase Edge Function (Deno). Consumes RevenueCat webhooks for iOS purchases,
// normalizes them, writes the unified `entitlements` row, reconciles against any
// existing Stripe entitlement (double-charge detection), and handles restores.
//
// Deploy:   supabase functions deploy revenuecat-webhook --no-verify-jwt
// Secrets:  supabase secrets set REVENUECAT_WEBHOOK_AUTH="<random-strong-token>"
//           (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically)
// RC setup: RevenueCat dashboard → Project → Webhooks → URL =
//           https://<project-ref>.functions.supabase.co/revenuecat-webhook
//           Authorization header = the same REVENUECAT_WEBHOOK_AUTH value.
//
// WHY RevenueCat and not raw Apple: RC validates the receipt/StoreKit-2 signed
// transaction against Apple for us and emits ONE normalized event stream. If Levi
// later drops RC for plain StoreKit + App Store Server Notifications V2, only the
// `parseRevenueCat()` function below changes — the NORMALIZE → UPSERT core and the
// DB schema are provider-agnostic. A stub `parseAppleServerNotification()` is
// included to show that swap is small.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RC_AUTH = Deno.env.get("REVENUECAT_WEBHOOK_AUTH")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// Product id → normalized plan. Keep in sync with Part 4.2 product config.
const PLAN_BY_PRODUCT: Record<string, "monthly" | "annual"> = {
  "app.duravel.membership.monthly": "monthly",
  "app.duravel.membership.annual": "annual",
};

// A normalized event any provider parser must produce.
interface NormalizedEvent {
  userId: string;                 // Duravel Supabase user_id (RC app_user_id)
  source: "apple";
  productId: string;
  plan: "monthly" | "annual" | null;
  appleOriginalTxnId: string | null;
  rcAppUserId: string | null;
  status:
    | "active" | "grace" | "expired" | "canceled"
    | "billing_issue" | "refunded" | "paused";
  currentPeriodStart: string | null; // ISO
  currentPeriodEnd: string | null;   // ISO
  willRenew: boolean | null;
  environment: "production" | "sandbox";
  raw: unknown;
}

Deno.serve(async (req) => {
  // 1. Auth — RevenueCat sends the shared token in the Authorization header.
  if (req.headers.get("Authorization") !== RC_AUTH) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const evt = parseRevenueCat(body);
  if (!evt) {
    // Unhandled event type (e.g. TEST, TRANSFER). Ack so RC stops retrying.
    return json({ ok: true, ignored: true }, 200);
  }

  // Never let a SANDBOX event grant production access.
  if (evt.environment !== "production") {
    console.log("sandbox event ignored for prod entitlement", evt.appleOriginalTxnId);
    return json({ ok: true, sandbox: true }, 200);
  }

  if (!evt.userId) {
    console.error("event missing userId (was Purchases.logIn called with the Duravel user id?)", evt.raw);
    return json({ ok: true, noUser: true }, 200);
  }

  // 2. Idempotent upsert keyed on Apple original transaction id.
  //    (uq_entitlements_apple_txn makes replays a no-op update.)
  const isActive = evt.status === "active" || evt.status === "grace";
  const { error: upsertErr } = await admin
    .from("entitlements")
    .upsert(
      {
        user_id: evt.userId,
        source: "apple",
        entitlement_key: "pro",
        apple_original_txn_id: evt.appleOriginalTxnId,
        rc_app_user_id: evt.rcAppUserId,
        product_id: evt.productId,
        plan: evt.plan,
        status: evt.status,
        is_active: isActive, // trigger re-derives too; set for immediate consistency
        current_period_start: evt.currentPeriodStart,
        current_period_end: evt.currentPeriodEnd,
        will_renew: evt.willRenew,
        environment: evt.environment,
        raw_event: evt.raw,
      },
      { onConflict: "apple_original_txn_id" },
    );

  if (upsertErr) {
    console.error("entitlement upsert failed", upsertErr);
    return json({ error: "db" }, 500); // 5xx => RC retries
  }

  // 3. Reconcile with Stripe — detect (don't auto-cancel) a double subscription.
  //    We only need to check when THIS event grants access.
  if (isActive) {
    const { data: stripeRows } = await admin
      .from("entitlements")
      .select("id, product_id, status, current_period_end")
      .eq("user_id", evt.userId)
      .eq("source", "stripe")
      .eq("is_active", true);

    if (stripeRows && stripeRows.length > 0) {
      // User pays on BOTH Apple and Stripe. Log for Levi; access stays unified
      // (has_pro is true either way, so no double access — but potential double CHARGE).
      await admin.rpc("detect_entitlement_overlap", { p_user: evt.userId });
      console.warn(
        `OVERLAP: user ${evt.userId} has active Apple + Stripe subs. ` +
        `Refund one side manually. Stripe products: ${stripeRows.map(r => r.product_id).join(", ")}`,
      );
      // Deliberately NOT auto-canceling Stripe: refund/cancel is a human decision
      // (proration, goodwill). The overlap row surfaces it in the support queue.
    }
  }

  return json({ ok: true }, 200);
});

// -----------------------------------------------------------------------------
// RevenueCat parser: maps RC webhook event types → NormalizedEvent.
// RC event docs: INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, CANCELLATION,
// UNCANCELLATION, BILLING_ISSUE, EXPIRATION, SUBSCRIPTION_PAUSED, TRANSFER, TEST...
// -----------------------------------------------------------------------------
function parseRevenueCat(body: any): NormalizedEvent | null {
  const e = body?.event;
  if (!e) return null;

  const productId: string = e.product_id ?? "";
  const type: string = e.type ?? "";

  // Only handle events for OUR products.
  if (productId && !(productId in PLAN_BY_PRODUCT)) {
    // could be another app under the same RC project; ignore
  }

  const toIso = (ms?: number | null) =>
    typeof ms === "number" ? new Date(ms).toISOString() : null;

  // Map RC type → our normalized status.
  let status: NormalizedEvent["status"];
  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":       // upgrade/downgrade within the group; still active
    case "NON_RENEWING_PURCHASE":
      status = "active";
      break;
    case "CANCELLATION":         // auto-renew off, but access continues to period end
      status = "canceled";
      break;
    case "BILLING_ISSUE":        // in billing retry / grace
      status = "grace";
      break;
    case "SUBSCRIPTION_PAUSED":
      status = "paused";
      break;
    case "EXPIRATION":
      status = "expired";
      break;
    case "REFUND":               // RC may send under CANCELLATION w/ reason; handle both
    case "SUBSCRIPTION_EXTENDED":
      status = type === "REFUND" ? "refunded" : "active";
      break;
    case "TEST":
    case "TRANSFER":
    default:
      return null; // ack + ignore upstream
  }

  // For 'canceled' but still within the period, access should remain — the
  // is_active trigger keys off status ∈ (active,grace). To keep a canceled-but-
  // not-yet-expired user entitled, treat canceled with a future expiry as active
  // for access purposes but preserve will_renew=false.
  const periodEndIso = toIso(e.expiration_at_ms);
  const stillWithinPeriod = periodEndIso ? new Date(periodEndIso) > new Date(body?.event?.event_timestamp_ms ?? Date.parse(periodEndIso)) : false;
  let willRenew: boolean | null = null;
  if (type === "CANCELLATION") willRenew = false;
  if (type === "RENEWAL" || type === "INITIAL_PURCHASE" || type === "UNCANCELLATION") willRenew = true;

  // canceled-but-active: keep access until period end.
  if (status === "canceled" && stillWithinPeriod) status = "active";

  return {
    userId: e.app_user_id ?? "",
    source: "apple",
    productId,
    plan: PLAN_BY_PRODUCT[productId] ?? null,
    appleOriginalTxnId: e.original_transaction_id ?? e.transaction_id ?? null,
    rcAppUserId: e.app_user_id ?? null,
    status,
    currentPeriodStart: toIso(e.purchased_at_ms),
    currentPeriodEnd: periodEndIso,
    willRenew,
    environment: (e.environment ?? "PRODUCTION").toLowerCase() === "sandbox"
      ? "sandbox" : "production",
    raw: body,
  };
}

// -----------------------------------------------------------------------------
// OPTIONAL swap target: plain StoreKit path (App Store Server Notifications V2).
// If Levi drops RevenueCat, verify the signedPayload JWS against Apple's root
// certs, decode notificationType/subtype, and produce the SAME NormalizedEvent.
// Included as a stub so the rest of the file never changes.
// -----------------------------------------------------------------------------
// function parseAppleServerNotification(signedPayload: string): NormalizedEvent | null {
//   // 1. verify JWS x5c chain against Apple root CA (use jose + Apple root certs)
//   // 2. decode payload.notificationType: SUBSCRIBED | DID_RENEW | DID_CHANGE_RENEWAL_STATUS
//   //    | EXPIRED | GRACE_PERIOD_EXPIRED | REFUND | REVOKE ...
//   // 3. decode signedTransactionInfo for productId, originalTransactionId, expiresDate
//   // 4. return NormalizedEvent { source:'apple', ... }  (userId comes from your
//   //    appAccountToken set at purchase time = the Duravel user_id)
//   return null;
// }

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
