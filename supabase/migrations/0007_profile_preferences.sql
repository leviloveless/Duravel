-- Profile personalization (new-additions #2, #3, #4)
--
-- Adds three optional profile fields. All nullable so existing rows keep working
-- and the app falls back to its defaults (max HR = 220 − age, standard zone
-- bands, engine-default day placement) whenever a column is null.

alter table profiles add column if not exists max_hr int
  check (max_hr is null or (max_hr between 100 and 230));

-- Custom HR zone bands: { z1:{low,high}, …, z5:{low,high} } as % of max HR.
alter table profiles add column if not exists hr_zones jsonb;

-- Day-placement preferences: { longRunDay?: <day>, restDays?: [<day>…] }.
alter table profiles add column if not exists day_preferences jsonb;
