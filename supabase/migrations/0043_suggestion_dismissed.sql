-- 0043: wearable_activities.suggestion_dismissed_at — "stop suggesting this one"
-- (Levi, 2026-08-13).
--
-- THE BUG. The program view's "Synced workouts ready to link" banner had a
-- Dismiss button that only ever set React state:
--
--     const [hidden, setHidden] = useState<Set<string>>(new Set());
--
-- so the card vanished until the next render and came straight back on reload,
-- on navigation, and on every `router.refresh()` — which the new Sync workouts
-- button fires on every sync. An athlete who dismissed the same Ride four times
-- was not doing anything wrong; nothing was ever written down.
--
-- CONFIRM was already durable and is untouched here: linking writes a
-- `workout_logs` row carrying `wearable_activity_id`, which makes the activity
-- `linked`, and `isLinkCandidate` already drops linked activities from both the
-- suggestions banner and the manual link list.
--
-- WHY A TIMESTAMP AND NOT A BOOLEAN. It answers "when did they dismiss this",
-- which a bool cannot, and that is the question worth having if suggestion
-- quality is ever tuned — a dismissal minutes after a sync means something
-- different from one weeks later. `self_posted` (0040) is a bool because it
-- states a fact about who wrote the row; this states an event.
--
-- WHY IT ONLY HIDES THE SUGGESTION. Dismiss means "stop suggesting this", not
-- "this workout never happened" (Levi's call). The activity stays in
-- `linkableActivities`, so it is still attachable by hand from the week table
-- afterwards and a mis-click costs nothing. Only the banner respects the flag.
--
-- Additive, nullable, idempotent. NULL = never dismissed, which is every
-- existing row, so nothing changes until an athlete presses the button.
--
-- ⚠️ Like `self_posted`, this column is NOT in `activityToRow`. The sync upsert
-- lists its own columns, so `ON CONFLICT DO UPDATE` never touches this one and a
-- dismissal survives every later re-sync of the same external_id. Without that,
-- the next sync would resurrect every dismissed card — the exact bug being fixed.

alter table wearable_activities
  add column if not exists suggestion_dismissed_at timestamptz;

comment on column wearable_activities.suggestion_dismissed_at is
  'When the athlete dismissed this activity from the same-day suggestions banner. NULL = never dismissed. Hides it from suggestions ONLY; it stays manually linkable.';

-- Partial: only dismissed rows are indexed, and they are the rare case.
create index if not exists wearable_activities_dismissed_idx
  on wearable_activities (user_id, suggestion_dismissed_at)
  where suggestion_dismissed_at is not null;
