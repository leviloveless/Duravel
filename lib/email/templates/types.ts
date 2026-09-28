/**
 * Typed props for every Duravel lifecycle email template.
 * All URLs are absolute (built from APP_URL / Stripe). Pre-format dates and money
 * upstream in the flow so templates stay pure-presentational.
 */

/** A footer link rendered in the shared _Layout footer. */
export interface FooterLink {
  label: string;
  href: string;
}

/** Fields common to every template. */
export interface BaseEmailProps {
  firstName: string;
  /** Preference center — /settings/email. */
  manageUrl: string;
}

export interface WelcomeProps extends BaseEmailProps {
  /** Program generator route. */
  generateUrl: string;
  /** Pre-formatted trial end date, e.g. "Jul 31". */
}

export interface OnboardingNudgeProps extends BaseEmailProps {
  generateUrl: string;
  daysLeft: number;
  /** Tokenized HMAC one-click unsubscribe (lifecycle category is suppressible). */
  unsubscribeUrl: string;
}

export type TrialEndingStage = "T-3" | "T-1" | "T-0";

export interface TrialEndingProps extends BaseEmailProps {
  stage: TrialEndingStage;
  /** Stripe checkout — monthly price ($19.99/mo). */
  subscribeUrl: string;
  /** Stripe checkout — annual price ($159.99/yr). Primary CTA on T-0. */
  annualUrl: string;
  /**
   * The user's own logged progress. When 0/undefined the template omits the
   * stat block and leads on "your adaptive plan pauses" instead — never renders
   * "0 sessions logged". Required for T-3; optional elsewhere.
   */
  sessionsLogged?: number;
  weeksCompleted?: number;
  /** e.g. "HYROX sub-70 block". */
  programName?: string;
}

/** Carded-trial notices (2026-09-28). See lib/email/trial-notice.ts. */
export interface TrialNoticeProps extends BaseEmailProps {
  kind: "started" | "ending";
  /** e.g. "Duravel Monthly". */
  planLabel: string;
  /** e.g. "$19.99/month" — the amount Stripe will actually charge, discounts included. */
  priceLine: string;
  /** e.g. "Oct 5, 2026" — the day the trial ends and the card is charged. */
  chargeDate: string;
  trialDays: number;
  /** Where to cancel — /settings (Manage billing). */
  cancelUrl: string;
  planUrl: string;
}

/** A group email written in /admin/broadcast (2026-09-28). */
export interface BroadcastProps extends BaseEmailProps {
  subject: string;
  paragraphs: string[];
  button: { label: string; url: string } | null;
  /** Tokenized one-click unsubscribe (product-updates category). */
  unsubscribeUrl: string;
  /** Physical postal address for the footer — required for group mail. */
  postalAddress: string;
}

export interface ReceiptProps extends BaseEmailProps {
  /** e.g. "Duravel Annual" or "Duravel Monthly". */
  planLabel: string;
  /** Pre-formatted charge, e.g. "$159.99". */
  amount: string;
  /** Pre-formatted next renewal date, e.g. "Jul 17, 2027". */
  renewalDate: string;
  /** This-week's-plan route. */
  planUrl: string;
  /** Stripe hosted invoice URL. */
  invoiceUrl: string;
  /** Stripe billing portal session URL. */
  billingPortalUrl: string;
}
