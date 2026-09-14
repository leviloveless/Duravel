/**
 * Pure, tested checks for the signup form (2026-09-13).
 *
 * These live here, not in the server action, for the reason the onboarding
 * checkers do (`lib/engine/input-checks.ts`): the signup form BLOCKS native
 * submit, and a form that blocks native submit owns every check native
 * validation would have done. `required`, `min`, `max` and `pattern` on those
 * inputs are decorative. The same functions run in the client form and again in
 * the server action, so a hand-crafted POST cannot get past what the UI enforces.
 *
 * The date-of-birth handling is deliberately paranoid, because the onboarding
 * equivalent was not and it cost three separate bug reports: an A race stored as
 * year 0226 produced a race on a day nobody picked, an ignored week template and
 * a build four weeks short. A two-digit year typed into a four-digit box is the
 * same mistake with the same shape, and here it would silently let a child
 * through the age gate or lock an adult out.
 */

/** The published policy set a signup consents to. Bump when any page materially changes. */
export const TERMS_VERSION = "2026-09-13";

/** Minimum age, from the Terms of Use ("You must be at least 13 years old"). */
export const MIN_AGE_YEARS = 13;

/** Nobody is older than this; a year that implies it is a typo, not a supercentenarian. */
const MAX_AGE_YEARS = 120;

export type DobParts = { month: string; day: string; year: string };

export type DobResult = { ok: true; iso: string; age: number } | { ok: false; error: string };

/**
 * Whole years between `dob` and `on`. Calendar-correct: someone born 29 Feb
 * whose birthday has not "occurred" in a common year still ages on 1 March,
 * because the month/day comparison below puts them past it.
 *
 * ⚠️ `on` is read with LOCAL getters, deliberately. A date of birth is a
 * calendar date, not an instant, and an age gate should turn over on the
 * athlete's own midnight rather than on UTC's — so do not "fix" this to
 * `getUTC*`. Two consequences worth knowing:
 *
 *   - Any test must build its fixed "today" with `new Date(y, m, d)`, never
 *     `Date.UTC` — the latter is the previous calendar day anywhere west of
 *     Greenwich, and every birthday-boundary assertion then reads a year young.
 *   - The form (browser, athlete's zone) and the server action (Vercel, UTC)
 *     can disagree for a few hours on the exact day someone turns 13. The
 *     server is the one that decides, and the window is hours wide on a single
 *     birthday, so it is documented rather than engineered around.
 */
export function ageOn(dobISO: string, on: Date = new Date()): number {
  const [y, m, d] = dobISO.split("-").map(Number) as [number, number, number];
  let age = on.getFullYear() - y;
  const month = on.getMonth() + 1;
  const day = on.getDate();
  if (month < m || (month === m && day < d)) age -= 1;
  return age;
}

/**
 * Validate the three date-of-birth boxes and return an ISO date plus the age.
 *
 * Rejects, in this order: anything non-numeric; a year outside a plausible human
 * range (which is what catches the two-digit "99" and the mistyped "0226");
 * a month/day that is not a real calendar date (31 February included — the
 * round-trip through Date is what proves it, since Date happily rolls 31 Feb
 * forward to 3 March); a date in the future; and finally the age gate.
 */
export function parseDob(parts: DobParts, now: Date = new Date()): DobResult {
  const raw = [parts.month, parts.day, parts.year].map((s) => (s ?? "").trim());
  if (raw.some((s) => s === "")) return { ok: false, error: "Enter your date of birth." };
  if (raw.some((s) => !/^\d+$/.test(s))) {
    return { ok: false, error: "Use numbers only for your date of birth." };
  }

  const [month, day, year] = raw.map(Number) as [number, number, number];

  // Checked BEFORE the calendar test so "99" reports the real problem (a
  // two-digit year) rather than a confusing "that date does not exist".
  const earliestYear = now.getFullYear() - MAX_AGE_YEARS;
  if (year < earliestYear || year > now.getFullYear()) {
    return {
      ok: false,
      error: `Enter your birth year as four digits, between ${earliestYear} and ${now.getFullYear()}.`,
    };
  }
  if (month < 1 || month > 12) return { ok: false, error: "Month must be between 1 and 12." };
  if (day < 1 || day > 31) return { ok: false, error: "Day must be between 1 and 31." };

  // Round-trip: Date rolls impossible dates forward (31 Feb becomes 3 March), so
  // a date that survives unchanged is a date that exists.
  const asDate = new Date(Date.UTC(year, month - 1, day));
  if (
    asDate.getUTCFullYear() !== year ||
    asDate.getUTCMonth() !== month - 1 ||
    asDate.getUTCDate() !== day
  ) {
    return { ok: false, error: "That date does not exist. Check the month and day." };
  }

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (asDate.getTime() > Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) {
    return { ok: false, error: "Your date of birth cannot be in the future." };
  }

  const age = ageOn(iso, now);
  if (age < MIN_AGE_YEARS) {
    return { ok: false, error: `You must be at least ${MIN_AGE_YEARS} years old to use Duravel.` };
  }
  return { ok: true, iso, age };
}

/**
 * Split a typed full name into first and last.
 *
 * `profiles.first_name` is what the dashboard greets people by, and it is the
 * only part that has to be right. Everything after the first token becomes the
 * last name, so "Levi Barton Loveless" greets "Levi" and keeps "Barton Loveless"
 * — which is better than dropping a middle name on the floor, and better than
 * guessing which token is the surname in a name shape we do not recognise.
 */
export function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: null };
  const [first, ...rest] = parts as [string, ...string[]];
  return { firstName: first, lastName: rest.length ? rest.join(" ") : null };
}

/** Sports offered at signup. Mirrors the `Sport` families without naming a distance. */
export const SIGNUP_SPORTS = ["hyrox", "deka", "triathlon", "running", "general_fitness"] as const;
export type SignupSport = (typeof SIGNUP_SPORTS)[number];

export const SIGNUP_SPORT_LABEL: Record<SignupSport, string> = {
  hyrox: "HYROX",
  deka: "DEKA",
  triathlon: "Triathlon",
  running: "Running",
  general_fitness: "General fitness",
};

export function isSignupSport(v: unknown): v is SignupSport {
  return typeof v === "string" && (SIGNUP_SPORTS as readonly string[]).includes(v);
}

export const SIGNUP_SEXES = ["male", "female", "other"] as const;
export type SignupSex = (typeof SIGNUP_SEXES)[number];

export function isSignupSex(v: unknown): v is SignupSex {
  return typeof v === "string" && (SIGNUP_SEXES as readonly string[]).includes(v);
}
