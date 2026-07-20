-- Athlete equipment + current training frequency (Tasks #17). Captured at
-- onboarding so sessions can be tailored to what the athlete actually has and how
-- much they currently train. Additive + nullable.

alter table profiles add column if not exists equipment jsonb;
alter table profiles add column if not exists current_days_per_week int
  check (current_days_per_week is null or current_days_per_week between 0 and 7);
