-- 0028: profiles.email — mirror the user's auth email onto their profile row.
--
-- Email is authoritative in auth.users; the email SENDER still resolves it from
-- there (lib/email/recipient.ts). This column is a convenience mirror so the
-- profiles table itself carries the address (querying, admin views, exports).
--
-- Kept in sync three ways: (1) backfilled below for existing rows; (2) written by
-- the onboarding profile upsert at profile creation/update (app); (3) a trigger on
-- auth.users updates it if the user later changes their auth email. The trigger
-- only UPDATEs an existing profile (never creates one — profiles carry NOT NULL
-- intake fields only onboarding supplies), so a signup with no profile yet is a
-- harmless no-op until onboarding writes the row.

alter table profiles add column if not exists email text;

-- Backfill existing profiles from auth.users.
update profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and p.email is distinct from u.email;

-- Keep profiles.email in sync when a user's auth email changes.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set email = new.email,
         updated_at = now()
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_profile_email_trg on auth.users;
create trigger sync_profile_email_trg
  after insert or update of email on auth.users
  for each row execute function public.sync_profile_email();

comment on column profiles.email is
  'Convenience mirror of auth.users.email (authoritative). Synced by the onboarding upsert + a trigger on auth.users; the email sender resolves from auth.users.';
