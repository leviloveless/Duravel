// Duravel iOS — Part 3
// Supabase Edge Function: delete-account
//
// App Store Guideline 5.1.1(v) requires that any app supporting account
// creation also lets the user INITIATE account + data deletion from within the
// app. This function performs the irreversible server-side deletion.
//
// Deploy:
//   supabase functions deploy delete-account
//   # Set the service-role secret (NEVER ship this in the app bundle):
//   supabase secrets set SERVICE_ROLE_KEY="<service_role_key>"
//   # SUPABASE_URL is provided automatically to Edge Functions.
//
// Why an Edge Function (not client SQL):
//   Removing the auth.users row requires the Auth Admin API, which needs the
//   service-role key. That key must stay server-side. The function:
//     1. Authenticates the caller from their bearer JWT (their own session).
//     2. Deletes app-owned rows for that user (belt-and-suspenders alongside
//        ON DELETE CASCADE — see the SQL file).
//     3. Calls auth.admin.deleteUser(userId), which cascades to auth.identities.
//
// Security: a user can ONLY delete THEMSELVES — we derive the id from the
// verified JWT, never from the request body.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

  // 1. Identify the caller from THEIR bearer token.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Missing Authorization bearer token' }, 401);

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const {
    data: { user },
    error: userErr,
  } = await asUser.auth.getUser();
  if (userErr || !user) return json({ error: 'Invalid or expired session' }, 401);

  const userId = user.id;

  // 2. Admin client (service role) for the actual deletion.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // 2a. Delete app-owned rows. If your schema uses ON DELETE CASCADE from a
    //     FK to auth.users (see SQL file), auth.admin.deleteUser alone suffices
    //     — but we clear explicitly for tables that don't cascade (e.g. rows
    //     keyed by user_id without a FK, storage objects, Stripe mirror rows).
    const tables = [
      'workouts',
      'workout_sessions',
      'programs',
      'program_enrollments',
      'progress_logs',
      'subscriptions',
      'profiles',
    ];
    for (const table of tables) {
      const { error } = await admin.from(table).delete().eq('user_id', userId);
      // profiles is keyed by `id`, not `user_id`; handle both.
      if (error && /column .*user_id.* does not exist/i.test(error.message)) {
        await admin.from(table).delete().eq('id', userId);
      } else if (error) {
        console.error(`[delete-account] ${table}:`, error.message);
      }
    }

    // 2b. Delete the user's storage objects (avatars, uploads), if any bucket.
    try {
      const { data: files } = await admin.storage
        .from('user-uploads')
        .list(userId, { limit: 1000 });
      if (files?.length) {
        await admin.storage
          .from('user-uploads')
          .remove(files.map((f) => `${userId}/${f.name}`));
      }
    } catch (e) {
      console.warn('[delete-account] storage cleanup skipped:', String(e));
    }

    // 2c. Delete the auth user (cascades to auth.identities / sessions).
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return json({ error: `Auth deletion failed: ${delErr.message}` }, 500);

    // NOTE (Stripe): this does NOT cancel a live Stripe subscription. If the
    // user is a paying subscriber, cancel it via the Stripe API BEFORE/here so
    // they aren't billed for a deleted account. Left as a Needs-Levi item —
    // wire in the Stripe secret + cancel call (Part 4/5 territory).

    return json({ ok: true, deletedUserId: userId }, 200);
  } catch (e) {
    console.error('[delete-account] fatal', e);
    return json({ error: 'Unexpected error during deletion' }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}
