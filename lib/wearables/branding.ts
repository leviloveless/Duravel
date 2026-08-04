/**
 * Strava activity-write branding (PURE, unit-testable).
 *
 * When an athlete links a synced Strava activity to a Duravel session, we can
 * (opt-in) write a short branded tag back onto that Strava activity's
 * description — a growth loop: their followers see the plan that produced the
 * session. This builds the description string; the network PUT lives in
 * `strava-api.ts`. Idempotent: re-branding the same activity never stacks tags.
 */

/**
 * Stable sentinel that OPENS Duravel's tag block. It must lead the block (not sit
 * in its suffix) so `stripBrandTag` can remove the whole tag — including its
 * dynamic session/week/program prefix — before a re-brand. Anything from this
 * marker to the end of the description is considered Duravel-owned.
 */
export const BRAND_MARKER = "— Duravel";
const BRAND_DOMAIN = "duravel.app";

export interface BrandContext {
  /** Program name, e.g. "12-Week HYROX Build". */
  programName?: string | null;
  /** 1-based program week. */
  weekNumber?: number | null;
  /** Human session label, e.g. "Threshold run". */
  sessionLabel?: string | null;
}

/** Remove any previously-appended Duravel tag block from a description. */
export function stripBrandTag(description: string | null | undefined): string {
  const text = description ?? "";
  const idx = text.indexOf(BRAND_MARKER);
  if (idx === -1) return text.replace(/\s+$/, "");
  // Cut back to before the marker, dropping the blank-line separator too.
  return text.slice(0, idx).replace(/\s+$/, "");
}

/** The one-line Duravel tag, e.g.
 *  "— Duravel · Threshold run · Week 6 · 12-Week HYROX Build · duravel.app". */
export function brandTagLine(ctx: BrandContext): string {
  const parts: string[] = [BRAND_MARKER];
  if (ctx.sessionLabel) parts.push(ctx.sessionLabel.trim());
  if (typeof ctx.weekNumber === "number" && ctx.weekNumber > 0)
    parts.push(`Week ${ctx.weekNumber}`);
  if (ctx.programName) parts.push(ctx.programName.trim());
  parts.push(BRAND_DOMAIN);
  return parts.join(" · ");
}

/**
 * Build the new description: the athlete's own text (with any prior Duravel tag
 * stripped) followed by a fresh tag block. Idempotent — passing an
 * already-branded description in yields the same output.
 */
export function buildBrandedDescription(
  existing: string | null | undefined,
  ctx: BrandContext,
  body?: string | null,
): string {
  const base = stripBrandTag(existing);
  // `body`, when given, is the full workout summary from
  // `lib/program/session-summary.ts`. It already opens with BRAND_MARKER and ends
  // with its own tag line, which is what keeps this idempotent: `stripBrandTag`
  // above removes the entire previously-written block, body included, so a
  // re-write replaces rather than stacks.
  const block = body?.trim() ? body.trim() : brandTagLine(ctx);
  return base.length ? `${base}\n\n${block}` : block;
}
