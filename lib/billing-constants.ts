/**
 * Billing constants with NO server imports.
 *
 * `lib/subscription.ts` reaches for the server Supabase client, which reaches
 * for `next/headers`, which makes the whole module server-only. That is correct
 * for entitlement logic and fatal for a constant a UI component wants to print:
 * the moment anything importing `TRIAL_DAYS` becomes a client component, the
 * build breaks somewhere that has nothing to do with billing.
 *
 * So the number lives here, importable from either side, and `subscription.ts`
 * re-exports it so existing callers do not have to care which file it came from.
 */

/**
 * Length of the free trial, in days.
 *
 * Passed to Stripe as `trial_period_days` when the Checkout session is created,
 * so this constant and the athlete's actual billing date cannot drift. Changing
 * it changes every NEW checkout; subscriptions already trialing keep the length
 * they were sold.
 *
 * Seven, not fourteen (2026-09-20): a fortnight is a long time to forget you
 * started something, and a forgotten card-required trial becomes a surprise
 * charge and a Stripe dispute.
 */
export const TRIAL_DAYS = 7;
