import type { Plan, Tier } from "./subscription";
import { env } from "./env";

/**
 * Stripe price id -> what it buys.
 *
 * This mapping used to live inline in the Stripe webhook, which is simultaneously
 * the only place it decides anything about real money and the only place nothing
 * could ever test it: the webhook's helpers close over `env` and sit in a route
 * module that reaches Stripe and Supabase on import, so exercising them meant
 * standing a server up against live Stripe. That is why this code path has run
 * against production traffic for the standard plans and never once for the custom
 * tier.
 *
 * Pulling the decision out into a pure function fixes exactly that. The
 * configured ids arrive as an ARGUMENT rather than off the module-level `env`,
 * which is the whole point — the case that matters most here is a price id that
 * matches nothing configured, and you cannot produce that case against a module
 * that has already parsed the process environment without mutating global state
 * out from under it. Passing the ids in makes the drift case a one-line test.
 *
 * The webhook's behaviour is preserved exactly; only its address changed.
 */

/**
 * The price ids this deployment knows about. Every field is optional because
 * every corresponding env var is: the app is expected to boot, and the pricing
 * page is expected to render, before billing is fully configured.
 */
export type ConfiguredPrices = {
  monthly?: string;
  annual?: string;
  customMonthly?: string;
};

export type PriceResolution = {
  /** Billing INTERVAL. Null when the price id matched nothing configured. */
  plan: Plan | null;
  /**
   * PRODUCT LEVEL. Always resolves to something, and deliberately fails closed.
   *
   * An unrecognised price id — a price created in the Stripe dashboard before
   * its env var was set, say — reads as `standard`, so the worst case is a
   * customer who paid for custom and waits for a redeploy. The reverse default
   * would hand the tier above to everyone the moment a single id drifted, and
   * the webhook is the only thing standing between a price and an entitlement.
   */
  tier: Tier;
  /**
   * True when we were handed a price id and NONE of the configured ids matched.
   *
   * This is the flag that makes failing closed survivable. Failing closed is the
   * right direction and also a completely silent one: a custom subscriber whose
   * price id does not match `STRIPE_PRICE_CUSTOM_MONTHLY` is written to the
   * database as `standard`, is quietly downgraded to the product they did not
   * buy, and nothing anywhere says so. The caller is expected to make noise on
   * this — see the warning in the webhook.
   *
   * A null price id is NOT unrecognised. There was nothing to recognise; that is
   * a different failure (Stripe handed us a subscription item with no price) and
   * it should not be reported as configuration drift.
   */
  unrecognized: boolean;
};

/**
 * An unset env var is `undefined`, but an env var set to an empty string — or to
 * a value with a stray newline, which is what pasting a price id into a hosting
 * dashboard tends to produce — is a configuration mistake rather than a
 * deliberate "off". Normalise both to "not configured" so an empty string can
 * never match an empty price id, and so whitespace cannot turn a correctly-copied
 * id into a silent downgrade. This repo has been bitten by exactly that shape of
 * bug before: see `envFlag`, which had to start accepting `TRUE` after a flag set
 * in the hosting dashboard read as OFF with no error anywhere.
 */
function configured(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve a Stripe price id into the interval and product level it buys.
 *
 * Order matters only in the misconfigured case where two env vars hold the same
 * id, and it is preserved from the original webhook helpers on purpose: annual
 * before monthly before custom for the interval, custom alone for the tier.
 */
export function resolvePrice(
  priceId: string | null | undefined,
  prices: ConfiguredPrices,
): PriceResolution {
  if (!priceId) return { plan: null, tier: "standard", unrecognized: false };

  const annual = configured(prices.annual);
  const monthly = configured(prices.monthly);
  const custom = configured(prices.customMonthly);

  let plan: Plan | null = null;
  if (priceId === annual) plan = "annual";
  else if (priceId === monthly) plan = "monthly";
  else if (priceId === custom) plan = "monthly";

  // The custom tier is billed monthly, so it shares an interval with the standard
  // monthly plan and is distinguished only here, by product level.
  const tier: Tier = priceId === custom ? "custom" : "standard";

  // `plan === null` is sufficient: matching the custom id above always sets a
  // plan, so nothing can be recognised as a tier while being an unrecognised
  // interval.
  return { plan, tier, unrecognized: plan === null };
}

/**
 * The price ids this deployment actually has, read from the validated env.
 *
 * Server-only in practice — these are not `NEXT_PUBLIC_*`, so they read as
 * undefined in the browser. Call it from a route handler or a server component
 * and pass the result down, never from a client component.
 */
export function pricesFromEnv(): ConfiguredPrices {
  return {
    monthly: env.STRIPE_PRICE_MONTHLY,
    annual: env.STRIPE_PRICE_ANNUAL,
    customMonthly: env.STRIPE_PRICE_CUSTOM_MONTHLY,
  };
}

/**
 * Whether the custom tier can actually be bought right now.
 *
 * One predicate, deliberately, because it is consulted from two places that must
 * never disagree: the pricing page decides whether to offer the plan, and the
 * checkout route decides whether to accept a request for it. If those two ever
 * answered differently the result is the bug this replaced — a page that
 * advertises a plan the server refuses.
 *
 * It is also the reason this is derived from the env var rather than kept as its
 * own feature flag. A separate flag is a second thing to remember, and the
 * failure mode of forgetting it is the one worth designing against: the price
 * gets created in Stripe, the env var gets set, and the plan stays hidden anyway
 * because nobody remembered the flag. Deriving it means configuring the price IS
 * shipping the plan.
 */
export function customTierIsPurchasable(prices: ConfiguredPrices): boolean {
  return configured(prices.customMonthly) !== undefined;
}
