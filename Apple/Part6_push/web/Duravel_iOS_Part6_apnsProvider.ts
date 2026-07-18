/**
 * Duravel iOS — Part 6
 * APNs provider abstraction (Deno / Supabase Edge runtime).
 *
 * Sends via APNs HTTP/2 using token-based auth (.p8 key → ES256 JWT). No native
 * deps: uses Web Crypto (available in Deno/Edge) to sign the JWT. This keeps the
 * edge function self-contained and provider-swappable.
 *
 * If you'd rather route through a provider (OneSignal, Expo, FCM-for-iOS, etc.),
 * implement the `PushProvider` interface with that SDK and swap it in the edge
 * function — the send path is written against the interface, not APNs directly.
 *
 * ENV required (set as Supabase function secrets):
 *   APNS_KEY_P8        -- full contents of the .p8 (BEGIN PRIVATE KEY ... END)
 *   APNS_KEY_ID        -- 10-char key id
 *   APNS_TEAM_ID       -- 10-char team id
 *   APNS_BUNDLE_ID     -- app.duravel   (used as apns-topic)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export type ApnsEnv = 'production' | 'sandbox';

export interface PushMessage {
  title: string;
  body: string;
  /** aps.category — enables actionable buttons registered natively. */
  category?: string;
  /** Custom data delivered to the client (must include duravel:// `link`). */
  data?: Record<string, string>;
  /** Badge number to set. Omit to leave unchanged. */
  badge?: number;
  /** Sound; 'default' or a bundled name. Omit for silent-ish delivery. */
  sound?: string;
  /** APNs collapse id — coalesces repeated pushes (e.g. streak). */
  collapseId?: string;
  /** Unix seconds; APNs stores-and-forwards until then. 0 = deliver now or drop. */
  expiration?: number;
  /** 10 = immediate, 5 = power-considerate. Default 10 for user-facing. */
  priority?: 5 | 10;
}

export interface SendResult {
  token: string;
  ok: boolean;
  status: number;
  /** APNs reason string, e.g. 'BadDeviceToken', 'Unregistered'. */
  reason?: string;
  /** True when the token is permanently dead and should be disabled. */
  tokenDead?: boolean;
}

export interface PushProvider {
  send(
    token: string,
    env: ApnsEnv,
    msg: PushMessage,
  ): Promise<SendResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// APNs JWT (ES256) — cached ~50 min (Apple requires refresh < 60 min).
// ─────────────────────────────────────────────────────────────────────────────

interface CachedJwt {
  token: string;
  issuedAt: number; // ms
}

let _jwtCache: CachedJwt | null = null;

function b64url(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlStr(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

/** Parse a PKCS#8 PEM (.p8) into a CryptoKey for ES256 signing. */
async function importP8(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

async function makeJwt(nowSec: number): Promise<string> {
  const keyId = mustEnv('APNS_KEY_ID');
  const teamId = mustEnv('APNS_TEAM_ID');
  const p8 = mustEnv('APNS_KEY_P8');

  const header = { alg: 'ES256', kid: keyId };
  const claims = { iss: teamId, iat: nowSec };
  const signingInput = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(claims))}`;

  const key = await importP8(p8);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  // Web Crypto returns raw r||s (64 bytes) which is exactly what JWS ES256 wants.
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

/**
 * Get a valid APNs JWT, refreshing if older than 50 min. `nowMs` is injected so
 * this is testable and doesn't rely on Date in a way that breaks determinism in
 * tests — in the edge runtime just pass Date.now().
 */
async function getJwt(nowMs: number): Promise<string> {
  const FIFTY_MIN = 50 * 60 * 1000;
  if (_jwtCache && nowMs - _jwtCache.issuedAt < FIFTY_MIN) {
    return _jwtCache.token;
  }
  const token = await makeJwt(Math.floor(nowMs / 1000));
  _jwtCache = { token, issuedAt: nowMs };
  return token;
}

function mustEnv(name: string): string {
  // deno-lint-ignore no-explicit-any
  const v = (globalThis as any).Deno?.env?.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function hostFor(env: ApnsEnv): string {
  return env === 'production'
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';
}

// Reasons that mean "this token is permanently dead — disable it".
const DEAD_TOKEN_REASONS = new Set([
  'BadDeviceToken',
  'Unregistered',
  'DeviceTokenNotForTopic',
]);

// ─────────────────────────────────────────────────────────────────────────────
// APNs provider implementation
// ─────────────────────────────────────────────────────────────────────────────

export function createApnsProvider(nowMsFn: () => number = () => Date.now()): PushProvider {
  const bundleId = mustEnv('APNS_BUNDLE_ID');

  return {
    async send(token, env, msg): Promise<SendResult> {
      const jwt = await getJwt(nowMsFn());

      const aps: Record<string, unknown> = {
        alert: { title: msg.title, body: msg.body },
      };
      if (msg.category) aps.category = msg.category;
      if (typeof msg.badge === 'number') aps.badge = msg.badge;
      if (msg.sound) aps.sound = msg.sound;

      const payload = { aps, ...(msg.data ?? {}) };

      const headers: Record<string, string> = {
        authorization: `bearer ${jwt}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': String(msg.priority ?? 10),
      };
      if (msg.collapseId) headers['apns-collapse-id'] = msg.collapseId;
      if (typeof msg.expiration === 'number') {
        headers['apns-expiration'] = String(msg.expiration);
      }

      let res: Response;
      try {
        res = await fetch(`${hostFor(env)}/3/device/${token}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
      } catch (err) {
        return { token, ok: false, status: 0, reason: String(err) };
      }

      if (res.status === 200) {
        return { token, ok: true, status: 200 };
      }

      let reason: string | undefined;
      try {
        const j = await res.json();
        reason = j?.reason;
      } catch {
        // no body
      }
      return {
        token,
        ok: false,
        status: res.status,
        reason,
        tokenDead: reason ? DEAD_TOKEN_REASONS.has(reason) : res.status === 410,
      };
    },
  };
}
