/**
 * Duravel iOS — Part 6
 * Supabase Edge Function: `send-push`
 *
 * Deploy path in repo: supabase/functions/send-push/index.ts
 * (this file is that index.ts; it imports apnsProvider.ts as a sibling module —
 *  place Duravel_iOS_Part6_apnsProvider.ts at supabase/functions/send-push/apnsProvider.ts)
 *
 * Responsibilities:
 *   1. AuthN: only callable by trusted server code (service-role bearer) OR by an
 *      internal shared secret header. NEVER expose this to the client directly.
 *   2. Look up the target user's live tokens.
 *   3. Gate on preferences + quiet hours via the `push_gate` SQL function.
 *   4. On quiet-hours suppression → DEFER (schedule for quiet_end) rather than drop
 *      (unless the caller passes `respectQuietHours: false` for transactional).
 *   5. Send to each token via the provider; disable dead tokens.
 *
 * Invoke (server-to-server):
 *   POST /functions/v1/send-push
 *   Authorization: Bearer <SERVICE_ROLE_KEY>
 *   { "user_id": "...", "category": "workout_reminder",
 *     "notification": { "title": "...", "body": "...", "data": { ... } } }
 *
 * The lifecycle fan-out (Part: lifecycle emails) calls this alongside the email
 * send so cadence stays unified — see LIFECYCLE_MAPPING.md.
 */

// @ts-nocheck  (Deno / Supabase Edge runtime types; keep the file portable)
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  createApnsProvider,
  type PushMessage,
  type PushProvider,
} from './apnsProvider.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type NotifCategory =
  | 'trial_ending'
  | 'workout_reminder'
  | 'streak'
  | 'plan_updated'
  | 'account'
  | 'marketing';

interface SendPushRequest {
  user_id: string;
  category: NotifCategory;
  notification: {
    title: string;
    body: string;
    data?: Record<string, string>; // must include duravel:// `link`
    badge?: number;
    sound?: string;
    collapseId?: string;
  };
  /** transactional override (account/security). Default false. */
  respectQuietHours?: boolean; // default true
  /** If true, on quiet-hours we drop instead of defer. Default false (defer). */
  dropIfQuiet?: boolean;
}

interface TokenRow {
  token: string;
  apns_env: 'production' | 'sandbox' | null;
  platform: 'ios' | 'android' | 'web';
}

// ─────────────────────────────────────────────────────────────────────────────
// Env
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Optional shared secret so internal callers other than service-role can invoke.
const INTERNAL_SECRET = Deno.env.get('SEND_PUSH_INTERNAL_SECRET') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Swap this line to use a different provider (OneSignal/Expo/FCM).
const provider: PushProvider = createApnsProvider();

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // AuthZ: require service-role bearer OR internal secret header.
  if (!isTrustedCaller(req)) {
    return json({ error: 'forbidden' }, 403);
  }

  let body: SendPushRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  if (!body.user_id || !body.category || !body.notification?.title) {
    return json({ error: 'missing_fields' }, 400);
  }

  const respectQuiet = body.respectQuietHours !== false; // default true
  const isTransactional = body.category === 'account';

  // 1) Preference + quiet-hours gate (single source of truth in SQL).
  //    Transactional (account) is allowed to bypass quiet hours by passing
  //    respectQuietHours:false, but STILL respects push_enabled inside push_gate.
  const { data: gateData, error: gateErr } = await admin.rpc('push_gate', {
    p_user_id: body.user_id,
    p_category: body.category,
  });

  if (gateErr) {
    return json({ error: 'gate_failed', detail: gateErr.message }, 500);
  }

  const gate = gateData as 'send' | 'suppressed_pref' | 'suppressed_quiet';

  if (gate === 'suppressed_pref') {
    return json({ status: 'suppressed', reason: 'preference', sent: 0 }, 200);
  }

  if (gate === 'suppressed_quiet' && respectQuiet && !isTransactional) {
    if (body.dropIfQuiet) {
      return json({ status: 'suppressed', reason: 'quiet_hours_drop', sent: 0 }, 200);
    }
    // DEFER: enqueue for delivery at the user's quiet_end. Requires a
    // `scheduled_pushes` table + a cron worker (see README "Deferral"). If you
    // haven't built that yet, this still returns cleanly and drops.
    const deferred = await tryDefer(body);
    return json(
      { status: deferred ? 'deferred' : 'suppressed', reason: 'quiet_hours', sent: 0 },
      200,
    );
  }
  // gate === 'send', OR quiet but transactional/override → proceed.

  // 2) Fetch live iOS tokens.
  const { data: tokens, error: tErr } = await admin
    .from('push_tokens')
    .select('token, apns_env, platform')
    .eq('user_id', body.user_id)
    .is('disabled_at', null)
    .eq('platform', 'ios');

  if (tErr) {
    return json({ error: 'token_lookup_failed', detail: tErr.message }, 500);
  }
  if (!tokens || tokens.length === 0) {
    return json({ status: 'no_tokens', sent: 0 }, 200);
  }

  // 3) Build the message.
  const msg: PushMessage = {
    title: body.notification.title,
    body: body.notification.body,
    category: body.category,
    data: withLink(body.category, body.notification.data),
    badge: body.notification.badge,
    sound: body.notification.sound ?? 'default',
    collapseId: body.notification.collapseId ?? collapseKeyFor(body),
    priority: 10,
  };

  // 4) Send to each token; collect dead ones.
  const results = await Promise.all(
    (tokens as TokenRow[]).map((t) =>
      provider.send(t.token, t.apns_env ?? 'production', msg),
    ),
  );

  const dead = results.filter((r) => r.tokenDead).map((r) => r.token);
  if (dead.length > 0) {
    await admin
      .from('push_tokens')
      .update({ disabled_at: new Date().toISOString() })
      .in('token', dead);
  }

  const sent = results.filter((r) => r.ok).length;
  return json(
    {
      status: 'ok',
      sent,
      failed: results.length - sent,
      disabled_tokens: dead.length,
      results: results.map((r) => ({ ok: r.ok, status: r.status, reason: r.reason })),
    },
    200,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isTrustedCaller(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : '';
  if (bearer && bearer === SERVICE_ROLE_KEY) return true;
  if (INTERNAL_SECRET) {
    const hdr = req.headers.get('x-internal-secret') ?? '';
    if (hdr && timingSafeEqual(hdr, INTERNAL_SECRET)) return true;
  }
  return false;
}

// Ensure data.link is present + is a duravel:// url; mirror the client fallbacks
// so a tap always routes through the Part 3 handler to a real screen.
function withLink(
  category: NotifCategory,
  data?: Record<string, string>,
): Record<string, string> {
  const d = { ...(data ?? {}) };
  d.category = category;
  if (!d.link || !d.link.startsWith('duravel://')) {
    d.link = serverFallbackLink(category, d);
  }
  return d;
}

function serverFallbackLink(category: NotifCategory, d: Record<string, string>): string {
  switch (category) {
    case 'workout_reminder':
      return d.session_id ? `duravel://session/${encodeURIComponent(d.session_id)}` : 'duravel://home';
    case 'plan_updated':
      return d.program_id ? `duravel://program/${encodeURIComponent(d.program_id)}` : 'duravel://home';
    case 'trial_ending':
      return 'duravel://account/billing';
    case 'streak':
      return 'duravel://progress/streak';
    default:
      return 'duravel://home';
  }
}

// Coalesce repeated same-kind pushes so a user doesn't get a stack of them.
function collapseKeyFor(body: SendPushRequest): string | undefined {
  switch (body.category) {
    case 'streak':
      return `streak:${body.user_id}`;
    case 'trial_ending':
      return `trial:${body.user_id}`;
    case 'workout_reminder':
      return body.notification.data?.session_id
        ? `session:${body.notification.data.session_id}`
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Best-effort deferral into a scheduled_pushes table. Returns true if enqueued.
 * If the table doesn't exist yet, swallow and return false (caller reports
 * 'suppressed'). The schema + worker are documented in the README.
 */
async function tryDefer(body: SendPushRequest): Promise<boolean> {
  try {
    // Compute the user's next quiet_end as a UTC timestamp.
    const { data: when, error } = await admin.rpc('next_quiet_end', {
      p_user_id: body.user_id,
    });
    if (error || !when) return false;

    const { error: insErr } = await admin.from('scheduled_pushes').insert({
      user_id: body.user_id,
      category: body.category,
      payload: body.notification,
      deliver_at: when,
    });
    return !insErr;
  } catch {
    return false;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
