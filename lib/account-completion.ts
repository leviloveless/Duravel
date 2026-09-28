import { TERMS_VERSION, isSignupSex, isSignupSport } from "@/lib/signup-checks";

/**
 * The first-login step (2026-09-28): what an account still owes before it can
 * use the app. PURE — the proxy calls it on every navigation, so it reads only
 * the auth user's metadata, which `getUser()` has already fetched. No query.
 *
 * WHO IT CATCHES. `/signup` collects name, date of birth, sex, sport and Terms
 * acceptance before an account exists. Four other doors skip that page:
 *   - accounts the admin creates by hand, and admin invitations;
 *   - Google (and later Apple) sign-in, which returns a name and nothing else;
 *   - accounts older than the signup page (2026-09-13).
 * Levi's decision: anyone missing any of it completes it once, on first login.
 *
 * TERMS VERSIONS. Acceptance is of a VERSION (`TERMS_VERSION`). When the Terms
 * change and the constant moves, everyone who accepted an earlier version is
 * asked once to accept the current one — they see only the Terms step, not the
 * whole form (Levi, 2026-09-28).
 *
 * PASSWORD. An account made by the admin (`created_by_admin`) has no password
 * until its owner picks one. It is asked for here unless `password_set` says
 * they already chose one through the set-a-password email.
 *
 * Metadata is writable by its own user through the auth API, so this is a gate
 * against ACCIDENTAL gaps, not a security boundary: an athlete can only skip it
 * by asserting on their own account what the form would have recorded. The
 * record of consent is the `profiles` row the completion action writes.
 */

export type CompletionNeeds = {
  /** No acceptance on file at all. */
  terms: boolean;
  /** Accepted an older version; only re-acceptance is needed for Terms. */
  termsUpdated: boolean;
  name: boolean;
  dob: boolean;
  sex: boolean;
  sport: boolean;
  password: boolean;
};

type Meta = Record<string, unknown> | null | undefined;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function completionNeeds(meta: Meta, version: string = TERMS_VERSION): CompletionNeeds {
  const m = meta ?? {};
  const acceptedAt = str(m.terms_accepted_at);
  const acceptedVersion = str(m.terms_version);
  return {
    terms: !acceptedAt,
    termsUpdated: !!acceptedAt && acceptedVersion !== version,
    name: !(str(m.first_name) ?? str(m.full_name) ?? str(m.name)),
    dob: !ISO_DATE.test(str(m.date_of_birth) ?? ""),
    sex: !isSignupSex(m.sex),
    sport: !isSignupSport(m.primary_sport),
    password: m.created_by_admin === true && m.password_set !== true,
  };
}

export function needsCompletion(n: CompletionNeeds): boolean {
  return n.terms || n.termsUpdated || n.name || n.dob || n.sex || n.sport || n.password;
}

/** Only the Terms changed: the short version of the page. */
export function onlyTermsUpdate(n: CompletionNeeds): boolean {
  return n.termsUpdated && !n.terms && !n.name && !n.dob && !n.sex && !n.sport && !n.password;
}

/**
 * The signed-in app. Public pages (home, science, legal, pricing's marketing
 * copy), auth routes, APIs and the admin console are left alone: the gate must
 * never stand between someone and the Terms they are being asked to read, the
 * sign-out button, or a webhook.
 */
const GATED_PREFIXES = [
  "/dashboard",
  "/program",
  "/onboarding",
  "/setup",
  "/start",
  "/library",
  "/calendar",
  "/events",
  "/activity",
  "/profile",
  "/settings",
  "/diagnostic",
  "/coaching",
  "/impact",
] as const;

export function isGatedPath(pathname: string): boolean {
  return GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Where to go after completing: the page they were heading to, if it is a path
 * on this site; otherwise /setup. Never an absolute or protocol-relative URL.
 */
export function safeNext(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return "/setup";
  if (s.startsWith("/welcome")) return "/setup";
  return s;
}
