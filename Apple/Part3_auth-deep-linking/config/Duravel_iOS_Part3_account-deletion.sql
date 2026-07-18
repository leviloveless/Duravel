-- Duravel iOS — Part 3
-- Account deletion: database-side guarantees.
--
-- The Edge Function (delete-account) does the auth-user removal, but the
-- cleanest, safest data cleanup is ON DELETE CASCADE foreign keys so that
-- deleting the auth user automatically removes every dependent row — no table
-- can be forgotten later. Run this in the Supabase SQL editor (idempotent-ish;
-- review before applying to production).
--
-- 1) Ensure every user-owned table references auth.users(id) with CASCADE.
--    Adjust table/column names to match the real Duravel schema.

-- profiles (keyed by id = auth uid)
alter table if exists public.profiles
  drop constraint if exists profiles_id_fkey,
  add constraint profiles_id_fkey
    foreign key (id) references auth.users (id) on delete cascade;

-- Generic user_id-owned tables:
do $$
declare
  t text;
  user_tables text[] := array[
    'workouts',
    'workout_sessions',
    'programs',
    'program_enrollments',
    'progress_logs',
    'subscriptions'
  ];
begin
  foreach t in array user_tables loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'alter table public.%I drop constraint if exists %I_user_id_fkey', t, t);
      execute format(
        'alter table public.%I add constraint %I_user_id_fkey
           foreign key (user_id) references auth.users (id) on delete cascade',
        t, t);
    end if;
  end loop;
end$$;

-- 2) OPTIONAL: a SECURITY DEFINER RPC so a signed-in user can delete their OWN
--    app rows without the Edge Function (does NOT remove the auth user — that
--    still needs the admin API). Useful as a fallback / for testing.
create or replace function public.delete_my_account_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.progress_logs        where user_id = uid;
  delete from public.program_enrollments   where user_id = uid;
  delete from public.workout_sessions      where user_id = uid;
  delete from public.workouts              where user_id = uid;
  delete from public.programs              where user_id = uid;
  delete from public.subscriptions         where user_id = uid;
  delete from public.profiles              where id = uid;
end;
$$;

revoke all on function public.delete_my_account_data() from public;
grant execute on function public.delete_my_account_data() to authenticated;

-- 3) Sanity: confirm the cascade is in place.
-- select conname, conrelid::regclass, confrelid::regclass, confdeltype
-- from pg_constraint
-- where confrelid = 'auth.users'::regclass;
-- confdeltype 'c' == ON DELETE CASCADE.
