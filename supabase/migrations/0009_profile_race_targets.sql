-- Profile race targets (Review #6 — station progression + goal-time pacing)
--
-- Optional. Division drives the HYROX station race loads used in hybrid work;
-- goal_finish_time seeds the race pacing plan (blank → predicted from benchmarks).
-- Both nullable so existing rows keep working (default division = Open).

alter table profiles add column if not exists division text
  check (division is null or division in ('open', 'pro'));

alter table profiles add column if not exists goal_finish_time text;
