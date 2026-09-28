/**
 * Pure rollups behind three read-only admin pages (2026-09-28): revenue &
 * conversion, wearable connections, and webhook health. No I/O here — the
 * loaders in lib/admin-ops-data.ts fetch, these decide, and every rule is tested.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── revenue & conversion ─────────────────────────────────────────────────────

/** A Stripe subscription reduced to what the rollups need. Times are ms. */
export type SubFact = {
  id: string;
  userId: string | null;
  status: string;
  createdMs: number;
  trialStartMs: number | null;
  trialEndMs: number | null;
  canceledAtMs: number | null;
  /** List price per billing interval, minor units. Discounts are not applied. */
  unitAmount: number;
  currency: string;
  interval: "month" | "year" | null;
};

/** What happened to a trial, once it has ended. */
export type TrialOutcome = "in_trial" | "converted" | "canceled_in_trial" | "no_trial";

/**
 * A trial "converted" when the subscription carried on past the trial end:
 * still billing now, or canceled only AFTER the trial ended (so at least one
 * charge was attempted). Canceled at or before the trial end — or expired
 * without ever paying — is a trial that did not convert.
 */
export function trialOutcome(s: SubFact, nowMs: number): TrialOutcome {
  if (s.trialStartMs === null || s.trialEndMs === null) return "no_trial";
  if (s.status === "trialing" && s.trialEndMs > nowMs) return "in_trial";
  if (s.status === "incomplete_expired") return "canceled_in_trial";
  if (s.canceledAtMs !== null && s.canceledAtMs <= s.trialEndMs) return "canceled_in_trial";
  if (["active", "past_due", "unpaid", "paused"].includes(s.status)) return "converted";
  if (s.status === "canceled") return "converted"; // canceled after the trial ended
  return "canceled_in_trial";
}

/** Paying now (not trialing). `past_due` still counts: Stripe is retrying the card. */
export function isPaying(s: SubFact): boolean {
  return s.status === "active" || s.status === "past_due";
}

/** Monthly recurring revenue of one subscription at list price, minor units. */
export function monthlyValue(s: SubFact): number {
  if (!isPaying(s)) return 0;
  if (s.interval === "year") return Math.round(s.unitAmount / 12);
  if (s.interval === "month") return s.unitAmount;
  return 0;
}

export type Funnel = {
  signups: number;
  builtProgram: number;
  startedTrial: number;
  converted: number;
  canceledInTrial: number;
  stillInTrial: number;
};

/**
 * The signup cohort funnel: of the accounts created in the window, how many
 * built a program, started a (carded) trial, and converted. Each account counts
 * once per stage, whatever number of subscriptions it has had.
 */
export function cohortFunnel(input: {
  signups: readonly { id: string; createdMs: number }[];
  usersWithProgram: ReadonlySet<string>;
  subs: readonly SubFact[];
  fromMs: number;
  nowMs: number;
}): Funnel {
  const cohort = input.signups.filter((u) => u.createdMs >= input.fromMs);
  const ids = new Set(cohort.map((u) => u.id));
  const byUser = new Map<string, SubFact[]>();
  for (const s of input.subs) {
    if (!s.userId || !ids.has(s.userId)) continue;
    const list = byUser.get(s.userId) ?? [];
    list.push(s);
    byUser.set(s.userId, list);
  }
  let startedTrial = 0;
  let converted = 0;
  let canceledInTrial = 0;
  let stillInTrial = 0;
  for (const subs of byUser.values()) {
    const outcomes = subs.map((s) => trialOutcome(s, input.nowMs)).filter((o) => o !== "no_trial");
    if (outcomes.length === 0) continue;
    startedTrial++;
    if (outcomes.includes("converted")) converted++;
    else if (outcomes.includes("in_trial")) stillInTrial++;
    else canceledInTrial++;
  }
  return {
    signups: cohort.length,
    builtProgram: cohort.filter((u) => input.usersWithProgram.has(u.id)).length,
    startedTrial,
    converted,
    canceledInTrial,
    stillInTrial,
  };
}

/** Share as a whole percent, or null when the base is zero. */
export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export type RevenueSummary = {
  mrrMinor: number;
  currency: string;
  paying: number;
  payingByPlan: { monthly: number; annual: number };
  inTrial: number;
  pastDue: number;
  /** Paying subscriptions canceled in the last 30 days (churn), and still-paying set to cancel. */
  churned30d: number;
};

export function revenueSummary(subs: readonly SubFact[], nowMs: number): RevenueSummary {
  const paying = subs.filter(isPaying);
  const currency = paying[0]?.currency ?? subs[0]?.currency ?? "usd";
  return {
    mrrMinor: paying.reduce((n, s) => n + monthlyValue(s), 0),
    currency,
    paying: paying.length,
    payingByPlan: {
      monthly: paying.filter((s) => s.interval === "month").length,
      annual: paying.filter((s) => s.interval === "year").length,
    },
    inTrial: subs.filter((s) => trialOutcome(s, nowMs) === "in_trial").length,
    pastDue: subs.filter((s) => s.status === "past_due").length,
    churned30d: subs.filter(
      (s) =>
        s.status === "canceled" &&
        s.canceledAtMs !== null &&
        s.canceledAtMs >= nowMs - 30 * DAY_MS &&
        trialOutcome(s, nowMs) !== "canceled_in_trial",
    ).length,
  };
}

/** Monday 00:00 UTC of the week containing `ms`. */
export function utcWeekStart(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Mon = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

export type WeekRow = { weekStartMs: number; signups: number; trials: number; conversions: number };

/**
 * Week-by-week activity for the last `weeks` weeks (UTC weeks, newest first):
 * new accounts, trials started, and trials that converted — the last dated at
 * the trial END, which is when the conversion actually happened.
 */
export function weeklyActivity(input: {
  signups: readonly { createdMs: number }[];
  subs: readonly SubFact[];
  nowMs: number;
  weeks: number;
}): WeekRow[] {
  const thisWeek = utcWeekStart(input.nowMs);
  const rows: WeekRow[] = [];
  for (let i = 0; i < input.weeks; i++) {
    rows.push({ weekStartMs: thisWeek - i * 7 * DAY_MS, signups: 0, trials: 0, conversions: 0 });
  }
  const oldest = rows[rows.length - 1]!.weekStartMs;
  const rowFor = (ms: number) =>
    ms >= oldest && ms < thisWeek + 7 * DAY_MS
      ? rows[Math.floor((thisWeek - utcWeekStart(ms)) / (7 * DAY_MS))]
      : undefined;
  for (const u of input.signups) {
    const r = rowFor(u.createdMs);
    if (r) r.signups++;
  }
  for (const s of input.subs) {
    if (s.trialStartMs !== null) {
      const r = rowFor(s.trialStartMs);
      if (r) r.trials++;
    }
    if (s.trialEndMs !== null && trialOutcome(s, input.nowMs) === "converted") {
      const r = rowFor(s.trialEndMs);
      if (r) r.conversions++;
    }
  }
  return rows;
}

// ─── wearable connections ─────────────────────────────────────────────────────

export type ConnectionFact = {
  userId: string;
  provider: string;
  lastSyncMs: number | null;
  createdMs: number;
};

export type ProviderRollup = {
  provider: string;
  connected: number;
  synced24h: number;
  synced7d: number;
  /** Connected but no sync in 7 days, or never. */
  stale: number;
  activities7d: number;
  activities30d: number;
};

export const STALE_AFTER_MS = 7 * DAY_MS;

export function isStale(c: ConnectionFact, nowMs: number): boolean {
  return c.lastSyncMs === null || nowMs - c.lastSyncMs > STALE_AFTER_MS;
}

export function providerRollup(
  connections: readonly ConnectionFact[],
  activities: readonly { provider: string; createdMs: number }[],
  nowMs: number,
): ProviderRollup[] {
  const providers = [
    ...new Set([...connections.map((c) => c.provider), ...activities.map((a) => a.provider)]),
  ].sort();
  return providers.map((provider) => {
    const conns = connections.filter((c) => c.provider === provider);
    const acts = activities.filter((a) => a.provider === provider);
    const within = (ms: number | null, span: number) => ms !== null && nowMs - ms <= span;
    return {
      provider,
      connected: conns.length,
      synced24h: conns.filter((c) => within(c.lastSyncMs, DAY_MS)).length,
      synced7d: conns.filter((c) => within(c.lastSyncMs, 7 * DAY_MS)).length,
      stale: conns.filter((c) => isStale(c, nowMs)).length,
      activities7d: acts.filter((a) => within(a.createdMs, 7 * DAY_MS)).length,
      activities30d: acts.filter((a) => within(a.createdMs, 30 * DAY_MS)).length,
    };
  });
}

// ─── webhook health ───────────────────────────────────────────────────────────

/** The Stripe events /api/stripe/webhook acts on. Keep in step with its switch. */
export const REQUIRED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.paid",
] as const;

/**
 * Events the app needs that this endpoint does not send. `*` sends everything.
 * `invoice.payment_succeeded` is accepted in place of `invoice.paid` — the route
 * handles either.
 */
export function missingStripeEvents(enabled: readonly string[]): string[] {
  if (enabled.includes("*")) return [];
  return REQUIRED_STRIPE_EVENTS.filter((e) => {
    if (e === "invoice.paid") {
      return !enabled.includes("invoice.paid") && !enabled.includes("invoice.payment_succeeded");
    }
    return !enabled.includes(e);
  });
}

/** Whether an endpoint URL is this app's Stripe webhook. */
export function isOurStripeEndpoint(url: string, siteUrl: string | null | undefined): boolean {
  try {
    const u = new URL(url);
    if (!u.pathname.replace(/\/+$/, "").endsWith("/api/stripe/webhook")) return false;
    if (!siteUrl) return true;
    return u.host === new URL(siteUrl).host;
  } catch {
    return false;
  }
}

export type MirrorRow = { userId: string; subscriptionId: string | null; status: string };

export type Drift =
  | { kind: "missing_row"; subscriptionId: string; userId: string | null; stripeStatus: string }
  | {
      kind: "status_differs";
      subscriptionId: string;
      userId: string;
      stripeStatus: string;
      appStatus: string;
    };

/**
 * Where the app's `subscriptions` mirror disagrees with Stripe. Only
 * subscriptions that can grant access (trialing / active / past_due) are checked
 * for a missing row: a missed webhook there means someone who pays has no access.
 * A status mismatch is reported for any subscription the app has a row for.
 */
export function mirrorDrift(stripeSubs: readonly SubFact[], rows: readonly MirrorRow[]): Drift[] {
  const bySub = new Map(rows.filter((r) => r.subscriptionId).map((r) => [r.subscriptionId!, r]));
  const out: Drift[] = [];
  for (const s of stripeSubs) {
    const row = bySub.get(s.id);
    if (!row) {
      if (["trialing", "active", "past_due"].includes(s.status)) {
        out.push({
          kind: "missing_row",
          subscriptionId: s.id,
          userId: s.userId,
          stripeStatus: s.status,
        });
      }
      continue;
    }
    if (row.status !== s.status) {
      out.push({
        kind: "status_differs",
        subscriptionId: s.id,
        userId: row.userId,
        stripeStatus: s.status,
        appStatus: row.status,
      });
    }
  }
  return out;
}
