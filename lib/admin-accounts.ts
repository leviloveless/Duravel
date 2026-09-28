import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  billingEnabled,
  resolveAccess,
  type AccessOverride,
  type ResolvedAccess,
  type SubscriptionRow,
} from "@/lib/subscription";
import {
  chunk,
  isSuspended,
  summarizeActivity,
  type ActivitySummary,
} from "@/lib/admin-account-rules";

/**
 * Reading accounts for the admin. SERVICE ROLE: these read other people's rows,
 * which RLS rightly forbids to any user JWT, the administrator's included. Only
 * ever called from code that has already passed `requireAdmin()`.
 *
 * Access is computed with `resolveAccess` — the same function every athlete's
 * own session uses — so the status shown here is what that athlete experiences,
 * not an admin-side approximation of it.
 */

/** Postgres "relation does not exist", or PostgREST's "not in schema cache". */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /does not exist|schema cache/i.test(error.message ?? "")
  );
}

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_sport: string | null;
};

type SubLite = SubscriptionRow & {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

const SUB_COLUMNS =
  "user_id, status, plan, tier, price_id, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id";

export type AccountRow = {
  id: string;
  email: string | null;
  name: string | null;
  primarySport: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  provider: string | null;
  suspended: boolean;
  hasProfile: boolean;
  programCount: number;
  subscription: SubLite | null;
  override: AccessOverride | null;
  access: ResolvedAccess;
};

const MAX_AUTH_PAGES = 10; // 10 x 1000 users. Past that, this screen needs server-side search.
const IN_BATCH = 150;

async function allAuthUsers(admin: SupabaseClient): Promise<User[]> {
  const out: User[] = [];
  for (let page = 1; page <= MAX_AUTH_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    out.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return out;
}

async function selectIn<T>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  key: string,
  ids: string[],
): Promise<{ rows: T[]; missing: boolean }> {
  const rows: T[] = [];
  for (const batch of chunk(ids, IN_BATCH)) {
    const { data, error } = await admin.from(table).select(columns).in(key, batch);
    if (error) {
      if (isMissingTable(error)) return { rows: [], missing: true };
      throw new Error(`${table}: ${error.message}`);
    }
    rows.push(...((data as unknown as T[] | null) ?? []));
  }
  return { rows, missing: false };
}

function nameOf(profile: ProfileLite | undefined, user: User): string | null {
  const fromProfile = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  if (fromProfile) return fromProfile;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fromMeta = meta.full_name ?? meta.name;
  return typeof fromMeta === "string" && fromMeta.trim() ? fromMeta.trim() : null;
}

function accountFrom(
  user: User,
  profile: ProfileLite | undefined,
  sub: SubLite | undefined,
  override: AccessOverride | undefined,
  programCount: number,
  nowMs: number,
): AccountRow {
  return {
    id: user.id,
    email: user.email ?? null,
    name: nameOf(profile, user),
    primarySport: profile?.primary_sport ?? null,
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at),
    provider: (user.app_metadata?.provider as string | undefined) ?? null,
    suspended: isSuspended((user as User & { banned_until?: string | null }).banned_until, nowMs),
    hasProfile: Boolean(profile),
    programCount,
    subscription: sub ?? null,
    override: override ?? null,
    access: resolveAccess(sub ? { ...sub, tier: sub.tier ?? "standard" } : null, {
      billingEnabled,
      now: nowMs,
      override: override ?? null,
    }),
  };
}

export async function listAccounts(): Promise<{
  accounts: AccountRow[];
  migrationMissing: boolean;
  capped: boolean;
}> {
  const admin = createAdminClient();
  const users = await allAuthUsers(admin);
  const ids = users.map((u) => u.id);
  const nowMs = Date.now();

  const [profiles, subs, overrides, programs] = await Promise.all([
    selectIn<ProfileLite>(admin, "profiles", "id, first_name, last_name, primary_sport", "id", ids),
    selectIn<SubLite>(admin, "subscriptions", SUB_COLUMNS, "user_id", ids),
    selectIn<AccessOverride & { user_id: string }>(
      admin,
      "entitlement_overrides",
      "user_id, access, grant_tier, grant_expires_at",
      "user_id",
      ids,
    ),
    selectIn<{ user_id: string }>(admin, "programs", "user_id", "user_id", ids),
  ]);

  const profileBy = new Map(profiles.rows.map((p) => [p.id, p]));
  const subBy = new Map(subs.rows.map((s) => [s.user_id, s]));
  const overrideBy = new Map(overrides.rows.map((o) => [o.user_id, o]));
  const programCount = new Map<string, number>();
  for (const p of programs.rows)
    programCount.set(p.user_id, (programCount.get(p.user_id) ?? 0) + 1);

  const accounts = users
    .map((u) =>
      accountFrom(
        u,
        profileBy.get(u.id),
        subBy.get(u.id),
        overrideBy.get(u.id),
        programCount.get(u.id) ?? 0,
        nowMs,
      ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    accounts,
    migrationMissing: overrides.missing,
    capped: users.length >= MAX_AUTH_PAGES * 1000,
  };
}

export type ProgramLite = {
  id: string;
  name: string | null;
  program_type: string;
  duration_weeks: number;
  status: string;
  start_date: string;
  created_at: string;
};

export type AccountDetail = {
  account: AccountRow;
  user: User;
  profile: Record<string, unknown> | null;
  subscriptionRow: Record<string, unknown> | null;
  programs: ProgramLite[];
  eventCount: number;
  migrationMissing: boolean;
};

export async function getAccountDetail(userId: string): Promise<AccountDetail | null> {
  const admin = createAdminClient();
  const { data: got, error } = await admin.auth.admin.getUserById(userId);
  if (error || !got?.user) return null;
  const user = got.user;

  const [profileRes, subRes, overrideRes, programsRes, eventsRes] = await Promise.all([
    admin.from("profiles").select("*").eq("id", userId).maybeSingle(),
    admin.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
    admin
      .from("entitlement_overrides")
      .select("access, grant_tier, grant_expires_at, note, updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("programs")
      .select("id, name, program_type, duration_weeks, status, start_date, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    admin.from("events").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);

  const profile = (profileRes.data as Record<string, unknown> | null) ?? null;
  const subscriptionRow = (subRes.data as Record<string, unknown> | null) ?? null;
  const override = overrideRes.error ? null : ((overrideRes.data as AccessOverride | null) ?? null);
  const programs = (programsRes.data as ProgramLite[] | null) ?? [];

  const profileLite: ProfileLite | undefined = profile
    ? {
        id: userId,
        first_name: (profile.first_name as string | null) ?? null,
        last_name: (profile.last_name as string | null) ?? null,
        primary_sport: (profile.primary_sport as string | null) ?? null,
      }
    : undefined;
  const subLite: SubLite | undefined = subscriptionRow
    ? {
        user_id: userId,
        status: subscriptionRow.status as SubscriptionRow["status"],
        plan: (subscriptionRow.plan as SubscriptionRow["plan"] | null) ?? null,
        tier: (subscriptionRow.tier as SubscriptionRow["tier"] | null) ?? "standard",
        price_id: (subscriptionRow.price_id as string | null) ?? null,
        current_period_end: (subscriptionRow.current_period_end as string | null) ?? null,
        cancel_at_period_end: Boolean(subscriptionRow.cancel_at_period_end),
        stripe_customer_id: (subscriptionRow.stripe_customer_id as string | null) ?? null,
        stripe_subscription_id: (subscriptionRow.stripe_subscription_id as string | null) ?? null,
      }
    : undefined;

  return {
    account: accountFrom(
      user,
      profileLite,
      subLite,
      override ?? undefined,
      programs.length,
      Date.now(),
    ),
    user,
    profile,
    subscriptionRow,
    programs,
    eventCount: eventsRes.count ?? 0,
    migrationMissing: isMissingTable(overrideRes.error),
  };
}

// ─── activity ─────────────────────────────────────────────────────────────────

export type AccountActivity = {
  summary: ActivitySummary | null;
  readinessCheckins: number | null;
  /** Latest day any HR/HRV reached us — the closest signal to "their wearable is syncing". */
  lastMetricDate: string | null;
};

/**
 * What the athlete has actually done. Each source is read independently and a
 * failure in one (a table not yet migrated, say) leaves the rest intact rather
 * than blanking the card.
 */
export async function getAccountActivity(
  userId: string,
  programIds: string[],
): Promise<AccountActivity> {
  const admin = createAdminClient();
  const ids = programIds.length ? programIds : ["00000000-0000-0000-0000-000000000000"];
  const [logs, extras, readiness, metric] = await Promise.all([
    admin.from("workout_logs").select("status, logged_at").in("program_id", ids),
    admin.from("extra_workouts").select("created_at").in("program_id", ids),
    admin
      .from("readiness_checkins")
      .select("week_number", { count: "exact", head: true })
      .in("program_id", ids),
    admin
      .from("daily_metrics")
      .select("date")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(1),
  ]);
  const summary =
    logs.error && extras.error
      ? null
      : summarizeActivity(
          (logs.data as { status: string; logged_at: string | null }[] | null) ?? [],
          (extras.data as { created_at: string | null }[] | null) ?? [],
          Date.now(),
        );
  const metricRow = (metric.data as { date: string }[] | null)?.[0];
  return {
    summary,
    readinessCheckins: readiness.error ? null : (readiness.count ?? 0),
    lastMetricDate: metric.error ? null : (metricRow?.date ?? null),
  };
}

// ─── data export ──────────────────────────────────────────────────────────────

type Section = { rows: unknown; error?: string };

async function section(
  q: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Section> {
  const { data, error } = await q;
  return error ? { rows: null, error: error.message } : { rows: data };
}

/**
 * Everything held on one athlete, for a privacy access request or a support
 * case. Read with the service role, then handed to the administrator as a file.
 *
 * Each table is its own section with its own error, so a table that is not
 * migrated yet shows up as an explained gap in the file, not a failed export.
 * The auth record is included WITHOUT tokens or password material — Supabase's
 * admin API does not return those anyway, and nothing here asks for them.
 */
export async function exportAccountData(userId: string): Promise<Record<string, unknown> | null> {
  const admin = createAdminClient();
  const { data: got, error } = await admin.auth.admin.getUserById(userId);
  if (error || !got?.user) return null;
  const u = got.user;

  const programs = await admin.from("programs").select("*").eq("user_id", userId);
  const programIds = ((programs.data as { id: string }[] | null) ?? []).map((p) => p.id);
  const ids = programIds.length ? programIds : ["00000000-0000-0000-0000-000000000000"];

  const [
    profile,
    subscription,
    override,
    events,
    logs,
    extras,
    adaptations,
    readiness,
    metrics,
    audit,
  ] = await Promise.all([
    section(admin.from("profiles").select("*").eq("id", userId).maybeSingle()),
    section(admin.from("subscriptions").select("*").eq("user_id", userId).maybeSingle()),
    section(admin.from("entitlement_overrides").select("*").eq("user_id", userId).maybeSingle()),
    section(admin.from("events").select("*").eq("user_id", userId)),
    section(admin.from("workout_logs").select("*").in("program_id", ids)),
    section(admin.from("extra_workouts").select("*").in("program_id", ids)),
    section(admin.from("adaptations").select("*").in("program_id", ids)),
    section(admin.from("readiness_checkins").select("*").in("program_id", ids)),
    section(admin.from("daily_metrics").select("*").eq("user_id", userId)),
    section(
      admin
        .from("admin_audit_log")
        .select("action, detail, created_at")
        .eq("target_user_id", userId)
        .order("created_at", { ascending: true }),
    ),
  ]);

  return {
    exported_at: new Date().toISOString(),
    exported_by: "Duravel LLC",
    account: {
      id: u.id,
      email: u.email ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      email_confirmed_at: u.email_confirmed_at ?? null,
      sign_in_methods: (u.identities ?? []).map((i) => i.provider),
      user_metadata: u.user_metadata ?? {},
    },
    profile,
    subscription,
    access_override: override,
    programs: programs.error
      ? { rows: null, error: programs.error.message }
      : { rows: programs.data },
    races: events,
    workout_logs: logs,
    extra_workouts: extras,
    adaptations,
    readiness_checkins: readiness,
    daily_metrics: metrics,
    account_changes_by_duravel: audit,
  };
}
