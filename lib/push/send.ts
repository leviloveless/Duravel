import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Web-push send helper. SERVER ONLY (only imported by /api/push/* + the cron
 * dispatcher).
 *
 * `web-push` is imported dynamically through a variable specifier, and its shape
 * is declared locally (WebPushLike) rather than via `typeof import("web-push")`.
 * That keeps the app type-checking AND building before `npm i web-push` has run
 * and without needing `@types/web-push`. Push is best-effort: if VAPID isn't
 * configured or the package isn't installed, `sendPushToUser` no-ops and returns
 * a zero-sent result instead of throwing.
 *
 * Subscriptions live in `push_subscriptions` (migration 0036). A 404/410 from a
 * push service means the browser subscription is dead, so we prune that row.
 */

export type PushPayload = {
  title: string;
  body: string;
  /** Where notificationclick routes (default /dashboard). */
  url?: string;
  /** Collapse key — a newer notification with the same tag replaces the old. */
  tag?: string;
};

export type PushResult = {
  sent: number;
  pruned: number;
  /** How many stored web subscriptions were found for the user. */
  found?: number;
  /** Sends that errored for a non-expiry reason (e.g. bad VAPID/keys). */
  failed?: number;
  /** Set when the send was a no-op: web-push not configured/installed. */
  skipped?: string;
  /** Set when the subscription read itself errored. */
  readError?: string;
  /** Raw push-service rejections (statusCode + body) for failed sends. */
  sendErrors?: string[];
};

/** Minimal shape of the parts of `web-push` we use — declared locally so this
 * module doesn't depend on the package (or its types) existing at build time. */
type PushSubscriptionShape = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
type WebPushLike = {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(subscription: PushSubscriptionShape, payload?: string): Promise<unknown>;
};

/** Is web-push configured (keys present)? Cheap gate for callers/UI. */
export function pushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

let cachedWebPush: WebPushLike | null = null;

/** VAPID keys must be UNPADDED URL-safe base64 (A-Z a-z 0-9 - _). Tolerate a
 * pasted env value that carries base64 padding, standard-base64 chars, wrapping
 * quotes, or stray whitespace/newlines — all of which make setVapidDetails throw
 * "must be a URL safe Base 64". Idempotent for an already-clean key. */
function normalizeVapidKey(raw: string | undefined): string {
  return (raw ?? "")
    .trim()
    .replace(/^["']|["']$/g, "") // wrapping quotes
    .replace(/\s+/g, "")          // any internal whitespace/newlines
    .replace(/\+/g, "-")          // standard-base64 -> url-safe
    .replace(/\//g, "_")
    .replace(/=+$/g, "");          // drop base64 padding
}

/** Lazily import + configure web-push. Returns { mod } on success, or { error }
 * describing why it's unavailable — never throws (a malformed VAPID key makes
 * setVapidDetails throw, which would otherwise 500 the route with no reason). */
async function getWebPush(): Promise<{ mod: WebPushLike | null; error?: string }> {
  if (!pushConfigured()) return { mod: null, error: "VAPID keys not configured" };
  if (cachedWebPush) return { mod: cachedWebPush };
  let mod: WebPushLike;
  try {
    // Static specifier so Next's output-file tracing bundles web-push into the
    // serverless function (a variable specifier is NOT traced -> missing in prod).
    mod = (await import("web-push")) as unknown as WebPushLike;
  } catch (e) {
    return { mod: null, error: `web-push not installed (${(e as Error)?.message ?? "import failed"})` };
  }
  try {
    mod.setVapidDetails(
      env.VAPID_SUBJECT || "mailto:support@duravel.app",
      normalizeVapidKey(env.VAPID_PUBLIC_KEY),
      normalizeVapidKey(env.VAPID_PRIVATE_KEY),
    );
  } catch (e) {
    // Almost always a malformed key (stray whitespace/newline/quote) or a bad
    // VAPID_SUBJECT (must be a mailto: or https: URL).
    return { mod: null, error: `VAPID setup failed: ${(e as Error)?.message ?? "invalid keys"}` };
  }
  cachedWebPush = mod;
  return { mod };
}

type SubRow = {
  id: string;
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
};

/**
 * Send one notification to every web subscription a user has. Best-effort:
 * returns { sent, pruned } and never throws for the common "not configured /
 * not installed" cases. Prunes expired (404/410) endpoints.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<PushResult> {
  const { mod: webpush, error: cfgError } = await getWebPush();
  if (!webpush) return { sent: 0, pruned: 0, skipped: cfgError ?? "web-push unavailable" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId)
    .eq("platform", "web");

  if (error) return { sent: 0, pruned: 0, found: 0, readError: error.message };

  const subs = (data ?? []) as SubRow[];
  if (subs.length === 0) return { sent: 0, pruned: 0, found: 0 };

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  const sendErrors: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (s) => {
      if (!s.p256dh || !s.auth) return;
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent += 1;
      } catch (err: unknown) {
        const e = err as { statusCode?: number; body?: string; message?: string };
        const code = e?.statusCode;
        if (code === 404 || code === 410) {
          dead.push(s.id);
        } else {
          failed += 1;
          // Surface the push service's actual response so a persistent failure is
          // diagnosable (403 = VAPID mismatch, 400 = bad request, etc.).
          const host = (() => {
            try {
              return new URL(s.endpoint).host;
            } catch {
              return "?";
            }
          })();
          const detail = String(e?.body || e?.message || "unknown").replace(/\s+/g, " ").slice(0, 180);
          sendErrors.push(`${host} ${code ?? "?"}: ${detail}`);
        }
      }
    }),
  );

  if (dead.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", dead);
  }

  return {
    sent,
    pruned: dead.length,
    found: subs.length,
    failed,
    sendErrors: sendErrors.length ? sendErrors : undefined,
  };
}
