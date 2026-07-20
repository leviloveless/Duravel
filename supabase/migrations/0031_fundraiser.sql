-- Race for Impact donation tracker (#19). A single editable row the admin updates
-- as donations come in; a public page (/impact) shows raised-vs-goal with a
-- progress bar for Levi's Instagram bio link. Amounts stored in cents (integer)
-- to avoid float drift.

create table if not exists fundraiser (
  id text primary key default 'main',
  title text not null default 'Race for Impact',
  tagline text,
  donate_url text,
  goal_cents integer not null default 0 check (goal_cents >= 0),
  raised_cents integer not null default 0 check (raised_cents >= 0),
  updated_at timestamptz not null default now()
);

-- Seed the single 'main' row so reads/updates always have a target.
insert into fundraiser (id) values ('main') on conflict (id) do nothing;

alter table fundraiser enable row level security;
-- Public read so the /impact page renders for logged-out visitors (IG link).
create policy "fundraiser: public read" on fundraiser for select using (true);
-- Writes are service-role only (admin edit form); no insert/update policy.
