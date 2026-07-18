-- Duravel iOS — Part 6
-- push_tokens: one row per (user, device token). Owner-only RLS.
-- Safe to run more than once (guards + IF NOT EXISTS where possible).
--
-- Depends on: auth.users (Supabase). No dependency on app tables.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enum for platform (extensible; android reserved for future Capacitor Android)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'push_platform') then
    create type public.push_platform as enum ('ios', 'android', 'web');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'apns_env') then
    create type public.apns_env as enum ('production', 'sandbox');
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  token       text not null,
  platform    public.push_platform not null default 'ios',
  apns_env    public.apns_env,                 -- null for non-apns platforms
  device_id   text,                            -- optional stable per-install id
  app_version text,
  disabled_at timestamptz,                     -- set when APNs reports token dead
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- A given APNs/FCM token string is globally unique to a device; enforce it so
  -- a re-install / account switch re-homes the token to the new user via upsert.
  constraint push_tokens_token_key unique (token)
);

comment on table public.push_tokens is
  'Native push device tokens. One row per token; token is globally unique. RLS: owner-only.';

-- Fast lookup of a user's live tokens on the send path.
create index if not exists push_tokens_user_live_idx
  on public.push_tokens (user_id)
  where disabled_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_push_tokens_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists push_tokens_touch on public.push_tokens;
create trigger push_tokens_touch
  before update on public.push_tokens
  for each row execute function public.tg_push_tokens_touch();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — owner can see/insert/update/delete only their own tokens.
-- The send path uses the service_role key, which BYPASSES RLS, so it can read
-- everyone's tokens. Client (anon/authenticated) is confined to its own rows.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.push_tokens enable row level security;
alter table public.push_tokens force row level security;

drop policy if exists push_tokens_select_own on public.push_tokens;
create policy push_tokens_select_own
  on public.push_tokens for select
  using (auth.uid() = user_id);

drop policy if exists push_tokens_insert_own on public.push_tokens;
create policy push_tokens_insert_own
  on public.push_tokens for insert
  with check (auth.uid() = user_id);

drop policy if exists push_tokens_update_own on public.push_tokens;
create policy push_tokens_update_own
  on public.push_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists push_tokens_delete_own on public.push_tokens;
create policy push_tokens_delete_own
  on public.push_tokens for delete
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Upsert RPC — called by the client. Re-homes a token to the current user and
-- clears any prior disabled flag. SECURITY INVOKER so RLS still applies
-- (auth.uid() must equal user_id), but the unique-token conflict resolution is
-- centralised here so the client never has to special-case a token owned by a
-- previous account on the same device.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.upsert_push_token(
  p_token       text,
  p_platform    public.push_platform default 'ios',
  p_apns_env    public.apns_env      default null,
  p_device_id   text                 default null,
  p_app_version text                 default null
)
returns public.push_tokens
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.push_tokens;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.push_tokens as t
    (user_id, token, platform, apns_env, device_id, app_version, disabled_at)
  values
    (auth.uid(), p_token, p_platform, p_apns_env, p_device_id, p_app_version, null)
  on conflict (token) do update
    set user_id     = auth.uid(),   -- re-home if a previous account owned it
        platform    = excluded.platform,
        apns_env    = excluded.apns_env,
        device_id   = coalesce(excluded.device_id, t.device_id),
        app_version = coalesce(excluded.app_version, t.app_version),
        disabled_at = null,
        updated_at  = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.upsert_push_token(text, public.push_platform, public.apns_env, text, text)
  to authenticated;
