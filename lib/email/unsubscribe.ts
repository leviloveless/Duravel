import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless HMAC unsubscribe tokens (07-spec §4.2). No DB read to verify — the token
 * is `base64url(userId·category·issuedAt) . HMAC_SHA256(secret, payload)`. Revocation is
 * the EFFECT of an unsubscribe (write email_preferences + email_unsubscribe_events), not
 * a property of the token, so there is no per-send token store to write.
 *
 * These functions take the secret as a parameter (pure) so they unit-test without env.
 */

export interface UnsubToken {
  userId: string;
  /** null = global unsubscribe. */
  category: string | null;
  /** ms epoch the token was issued. */
  issuedAt: number;
}

const SEP = String.fromCharCode(0); // NUL — cannot appear in a uuid or our category slugs

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}
function unb64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}
function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Mint a token. category=null means "unsubscribe from everything". */
export function mintUnsubToken(token: UnsubToken, secret: string): string {
  const payload = b64url([token.userId, token.category ?? "", String(token.issuedAt)].join(SEP));
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify + decode a token. Returns the token on success, or null if the signature is
 * invalid, the shape is wrong, or (when maxAgeMs is given) it has expired.
 */
export function verifyUnsubToken(
  raw: string,
  secret: string,
  opts?: { maxAgeMs?: number; nowMs?: number },
): UnsubToken | null {
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const parts = unb64url(payload).split(SEP);
  if (parts.length !== 3) return null;
  const [userId, category, issuedRaw] = parts as [string, string, string];
  const issuedAt = Number(issuedRaw);
  if (!userId || !Number.isFinite(issuedAt)) return null;

  if (opts?.maxAgeMs != null) {
    const now = opts.nowMs ?? Date.now();
    if (now - issuedAt > opts.maxAgeMs) return null;
  }
  return { userId, category: category === "" ? null : category, issuedAt };
}
