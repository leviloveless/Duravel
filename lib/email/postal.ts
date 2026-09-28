/**
 * The physical postal address every Duravel email prints in its footer
 * (CAN-SPAM). One source since 2026-09-28: EMAIL_POSTAL_ADDRESS when it is set,
 * otherwise the address the lifecycle templates have always carried
 * (`MAILING_ADDRESS` in templates/styles.ts). Group email from the admin refuses
 * to send until the setting exists — see lib/admin-broadcast.ts.
 */

/** A usable address from raw text, or null. Anything too short to be an address counts as unset. */
export function postalAddressFrom(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  return s.length >= 10 ? s : null;
}

/** The footer address: the configured one if valid, else the fallback. */
export function footerAddress(configured: string | null | undefined, fallback: string): string {
  return postalAddressFrom(configured) ?? fallback;
}
