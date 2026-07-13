-- Fix cost tracking (roadmap #0.3).
-- 0003 created generation_events with only SELECT + INSERT policies; 0004 added
-- input_tokens / output_tokens / cost_usd columns that /api/generate and
-- /api/adapt/apply stamp with an UPDATE after the run. With RLS enabled and no
-- UPDATE policy, those updates matched 0 rows silently, so cost_usd was never
-- populated. Allow a user to update their own event rows so the stamp lands.

create policy "generation_events: update own" on generation_events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
