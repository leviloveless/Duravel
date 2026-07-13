-- Profile HR inputs (Review #3 — personalized heart-rate zones)
--
-- Adds three optional profile fields that improve HR-zone accuracy. All
-- nullable so existing rows keep working: with none set the app uses a
-- sex-specific max-HR age formula and %HRmax zones; a resting HR unlocks
-- heart-rate-reserve (Karvonen) zones; a threshold HR unlocks lactate-
-- threshold (Friel) zones.

alter table profiles add column if not exists sex text
  check (sex is null or sex in ('male', 'female', 'other'));

alter table profiles add column if not exists resting_hr int
  check (resting_hr is null or (resting_hr between 25 and 120));

alter table profiles add column if not exists threshold_hr int
  check (threshold_hr is null or (threshold_hr between 90 and 220));
