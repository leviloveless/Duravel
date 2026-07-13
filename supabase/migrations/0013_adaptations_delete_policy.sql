-- Allow a user to delete their own adaptation rows (roadmap #1.9).
-- applyAdaptation now writes the audit row BEFORE the Haiku refill so the unique
-- (program_id, week_number) constraint serializes concurrent applies (lock
-- before spending). If the refill then fails, it rolls the lock row back with a
-- DELETE so the user can retry — which needs a delete policy (0006 created the
-- table append-only). Rows are only ever deleted on a failed apply that never
-- committed a change, so audit integrity of applied reviews is preserved.

create policy "adaptations: delete own" on adaptations
  for delete using (auth.uid() = user_id);
