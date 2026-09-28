import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { stripeAdmin } from "@/lib/admin-billing";
import { allAuthUsers } from "@/lib/admin-accounts";
import {
  cohortFunnel,
  isOurStripeEndpoint,
  isStale,
  mirrorDrift,
  missingStripeEvents,
  providerRollup,
  revenueSummary,
  weeklyActivity,
  type ConnectionFact,
  type Drift,
  type Funnel,
  type ProviderRollup,
  type RevenueSummary,
  type SubFact,
  type WeekRow,
} from "@/lib/admin-ops";

/**
 * Loaders for the revenue, wearables and webhooks admin pages (2026-09-28).
 * Reads only. The decisions are in lib/admin-ops.ts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_STRIPE_SUBS = 3000;

function toFact(s: Stripe.Subscription): SubFact {
  const price = s.items.data[0]?.price;
  const interval = price?.recurring?.interval;
  return {
    id: s.id,
    userId: s.metadata?.user_id ?? null,
    status: s.status,
    createdMs: s.created * 1000,
    trialStartMs: s.trial_start ? s.trial_start * 1000 : null,
    trialEndMs: s.trial_end ? s.trial_end * 1000 : null,
    canceledAtMs: s.canceled_at ? s.canceled_at * 1000 : null,
    unitAmount: price?.unit_amount ?? 0,
    currency: price?.currency ?? "usd",
    interval: interval === "month" || interval === "year" ? interval : null,
  };
}

async function allStripeSubs(stripe: Stripe): Promise<{ subs: SubFact[]; capped: boolean }> {
  const subs: SubFact[] = [];
  for await (const s of stripe.subscriptions.list({ status: "all", limit: 100 })) {
    subs.push(toFact(s));
    if (subs.length >= MAX_STRIPE_SUBS) return { subs, capped: true };
  }
  return { subs, capped: false };
}

// ─── revenue ──────────────────────────────────────────────────────────────────

export type RevenueReport =
  | { configured: false }
  | {
      configured: true;
      error: string | null;
      summary: RevenueSummary | null;
      funnels: { label: string; days: number | null; funnel: Funnel }[];
      weeks: WeekRow[];
      capped: boolean;
      liveMode: boolean;
    };

export async function getRevenueReport(nowMs: number): Promise<RevenueReport> {
  const stripe = stripeAdmin();
  if (!stripe) return { configured: false };
  try {
    const admin = createAdminClient();
    const [{ subs, capped }, users, programsRes] = await Promise.all([
      allStripeSubs(stripe),
      allAuthUsers(admin),
      admin.from("programs").select("user_id").eq("status", "ready"),
    ]);
    const signups = users.map((u) => ({ id: u.id, createdMs: Date.parse(u.created_at) }));
    const usersWithProgram = new Set(
      ((programsRes.data ?? []) as { user_id: string }[]).map((p) => p.user_id),
    );
    const funnel = (days: number | null) =>
      cohortFunnel({
        signups,
        usersWithProgram,
        subs,
        fromMs: days === null ? 0 : nowMs - days * DAY_MS,
        nowMs,
      });
    return {
      configured: true,
      error: null,
      summary: revenueSummary(subs, nowMs),
      funnels: [
        { label: "Last 30 days", days: 30, funnel: funnel(30) },
        { label: "Last 90 days", days: 90, funnel: funnel(90) },
        { label: "All time", days: null, funnel: funnel(null) },
      ],
      weeks: weeklyActivity({ signups, subs, nowMs, weeks: 12 }),
      capped,
      liveMode: (env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_"),
    };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      summary: null,
      funnels: [],
      weeks: [],
      capped: false,
      liveMode: false,
    };
  }
}

// ─── wearables ────────────────────────────────────────────────────────────────

export type WearablesReport = {
  providers: ProviderRollup[];
  stale: { email: string | null; userId: string; provider: string; lastSyncMs: number | null }[];
  configured: { provider: string; on: boolean }[];
  error: string | null;
};

export async function getWearablesReport(nowMs: number): Promise<WearablesReport> {
  const configured = [
    { provider: "strava", on: !!(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET) },
    { provider: "garmin", on: !!(env.GARMIN_CLIENT_ID && env.GARMIN_CLIENT_SECRET) },
    { provider: "oura", on: !!(env.OURA_CLIENT_ID && env.OURA_CLIENT_SECRET) },
    { provider: "apple_health", on: (env.HEALTHKIT_ENABLED ?? "").trim().toLowerCase() === "true" },
  ];
  try {
    const admin = createAdminClient();
    const since = new Date(nowMs - 30 * DAY_MS).toISOString();
    const [connRes, actRes, users] = await Promise.all([
      admin.from("wearable_connections").select("user_id, provider, last_sync_at, created_at"),
      admin
        .from("wearable_activities")
        .select("provider, created_at")
        .gte("created_at", since)
        .limit(20000),
      allAuthUsers(admin),
    ]);
    if (connRes.error) throw new Error(`wearable_connections: ${connRes.error.message}`);
    const connections: ConnectionFact[] = (
      (connRes.data ?? []) as {
        user_id: string;
        provider: string;
        last_sync_at: string | null;
        created_at: string;
      }[]
    ).map((c) => ({
      userId: c.user_id,
      provider: c.provider,
      lastSyncMs: c.last_sync_at ? Date.parse(c.last_sync_at) : null,
      createdMs: Date.parse(c.created_at),
    }));
    const activities = ((actRes.data ?? []) as { provider: string; created_at: string }[]).map(
      (a) => ({ provider: a.provider, createdMs: Date.parse(a.created_at) }),
    );
    const emailOf = new Map(users.map((u) => [u.id, u.email ?? null]));
    return {
      providers: providerRollup(connections, activities, nowMs),
      stale: connections
        .filter((c) => isStale(c, nowMs))
        .sort((a, b) => (a.lastSyncMs ?? 0) - (b.lastSyncMs ?? 0))
        .map((c) => ({
          email: emailOf.get(c.userId) ?? null,
          userId: c.userId,
          provider: c.provider,
          lastSyncMs: c.lastSyncMs,
        })),
      configured,
      error: null,
    };
  } catch (err) {
    return {
      providers: [],
      stale: [],
      configured,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── webhooks ─────────────────────────────────────────────────────────────────

export type EndpointHealth = {
  id: string;
  url: string;
  status: string;
  ours: boolean;
  missing: string[];
  apiVersion: string | null;
};

export type WebhooksReport =
  | { configured: false }
  | {
      configured: true;
      error: string | null;
      endpoints: EndpointHealth[];
      undelivered: { id: string; type: string; createdMs: number; pending: number }[];
      lastEvent: { type: string; createdMs: number } | null;
      drift: Drift[];
      checkedSubs: number;
      webhookSecretSet: boolean;
    };

export async function getWebhooksReport(): Promise<WebhooksReport> {
  const stripe = stripeAdmin();
  if (!stripe) return { configured: false };
  const webhookSecretSet = !!env.STRIPE_WEBHOOK_SECRET;
  try {
    const admin = createAdminClient();
    const [endpoints, failed, recent, subsPage, rowsRes] = await Promise.all([
      stripe.webhookEndpoints.list({ limit: 20 }),
      stripe.events.list({ delivery_success: false, limit: 25 }),
      stripe.events.list({ limit: 1 }),
      stripe.subscriptions.list({ status: "all", limit: 100 }),
      admin.from("subscriptions").select("user_id, stripe_subscription_id, status"),
    ]);
    const rows = (
      (rowsRes.data ?? []) as {
        user_id: string;
        stripe_subscription_id: string | null;
        status: string;
      }[]
    ).map((r) => ({
      userId: r.user_id,
      subscriptionId: r.stripe_subscription_id,
      status: r.status,
    }));
    const first = recent.data[0];
    return {
      configured: true,
      error: null,
      endpoints: endpoints.data.map((e) => ({
        id: e.id,
        url: e.url,
        status: e.status,
        ours: isOurStripeEndpoint(e.url, env.NEXT_PUBLIC_SITE_URL),
        missing: missingStripeEvents(e.enabled_events),
        apiVersion: e.api_version ?? null,
      })),
      undelivered: failed.data.map((ev) => ({
        id: ev.id,
        type: ev.type,
        createdMs: ev.created * 1000,
        pending: ev.pending_webhooks,
      })),
      lastEvent: first ? { type: first.type, createdMs: first.created * 1000 } : null,
      drift: mirrorDrift(subsPage.data.map(toFact), rows),
      checkedSubs: subsPage.data.length,
      webhookSecretSet,
    };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      endpoints: [],
      undelivered: [],
      lastEvent: null,
      drift: [],
      checkedSubs: 0,
      webhookSecretSet,
    };
  }
}
