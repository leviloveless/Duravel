-- Site-wide announcements, set from /admin/announcements (2026-09-28).
--
-- Shown to signed-in athletes in a strip under the nav. Written ONLY by the
-- service role from the admin actions; there are no insert/update/delete
-- policies, so no user JWT can post one.
--
-- READABLE BY `anon` ON PURPOSE. The banner is fetched with the anon key and no
-- cookies so it can be cached for a minute across every request, rather than
-- costing each page view a query under that athlete's session. An active
-- announcement is public by nature — it is a message to everyone — so nothing is
-- exposed by letting an unauthenticated read see it. Inactive rows are not.

create table if not exists public.site_announcements (
  id          bigint generated always as identity primary key,
  message     text not null check (char_length(message) between 1 and 280),
  tone        text not null default 'info' check (tone in ('info', 'warning')),
  link_url    text,
  link_label  text,
  active      boolean not null default true,
  ends_at     timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.site_announcements enable row level security;

drop policy if exists "site_announcements: read active" on public.site_announcements;
create policy "site_announcements: read active"
  on public.site_announcements
  for select
  to anon, authenticated
  using (active and (ends_at is null or ends_at > now()));

-- At most one active announcement. The admin action deactivates the previous
-- one before inserting; this makes a second active row impossible even if two
-- saves race.
create unique index if not exists site_announcements_one_active
  on public.site_announcements ((true)) where active;
