-- Auto-post completed workouts to Strava (opt-out; default ON).
-- Read by the /api/logs handler via autoPostSessionToStrava; toggled from
-- Settings → Connections. The whole feature is still gated by the
-- STRAVA_WRITE_ENABLED env flag and the connection holding activity:write.

alter table public.profiles
  add column if not exists strava_autopost boolean not null default true;
