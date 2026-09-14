# Duravel Handoff — Events (09-14-26)

## Apply

```
cd C:\dev\duravel
git apply --check duravel_events_0914.patch && git apply duravel_events_0914.patch
npm run test          # expect 154 files / 1858 tests (+10 of yours = 1868)
npm run build
```

Then run **migration 0047** in Supabase. A standalone copy is at
`Handoffs\0047_events.sql` if you want to read it first — do NOT copy that into
`supabase/migrations/`, the patch already puts the real one there.

**0047 is idempotent.** Safe to run twice.

## Your four answers, and what they became

| You chose | Built as |
| --- | --- |
| Promote `races` → `events` | `alter table races rename to events`, + user_id, name, sport, goal_time, notes, source |
| Split authority, surface the drift | Nothing auto-syncs; `dateDrift` shows the mismatch with a recalculate link |
| Multiple A races + close-race warning | Countdown shows the NEXT A race; `closeARaces` warns under 8 weeks apart |
| Prefill onboarding | "Build a program for this" → `/onboarding?eventId=…`, prefilled via the form's existing `initial` prop |

## ⚠️ Your premise on question 1 was wrong, and it flipped the answer

You said `races` "sits in the generation path and I don't want to destabilise
it". It doesn't — **`races` was write-only.** Onboarding inserts rows at
generation and replaces them on recalculate, and **nothing ever read them back.**
The engine takes race dates from `input_snapshot`; every surface reads
`week.raceDay` out of `program_data`.

So widening it was the *low*-risk option, and a separate table would have left a
vestigial twin that could disagree about the same race. That's why I promoted it.

## Two traps this would have hit

**The RLS policy had to be replaced.** The 0001 policy scopes through the owning
program — `exists (select 1 from programs where p.id = races.program_id ...)`.
With `program_id` nullable that EXISTS is FALSE for every athlete-created event,
so they'd be invisible to SELECT and rejected on INSERT **with nothing logged**.
That's your documented `rls-silent-noop` shape; the feature would have looked
broken for reasons nothing reported. Policy now scopes on `user_id`.

**`source` stops recalculate eating your races.** Regenerate does
`delete().eq("program_id", programId)`. Once an athlete's event can be linked to
a program, that delete takes it too — silently destroying a race you typed by
hand because you recalculated the block. Generator rows are `source='program'`
and are the only ones regeneration may delete. The event actions are scoped to
`source='athlete'` for the same reason in reverse, which is also why the UI shows
"From a program" instead of Edit/Delete on generator rows.

## What you'll see

- **`/events`** — add, edit, delete races. A/B/C with what each means inline.
- **Dashboard "Races" card** — next five, countdowns, plus the two warnings.
- **The hero countdown now reads your events first** and names the race
  ("76 days to HYROX Dallas"), falling back to the block's own race week.

## Verification

1858 tests in UTC, America/New_York and Australia/Sydney. Typecheck clean, build
clean, patch proved to reproduce the tested tree byte-for-byte.

**Not verified:** the migration itself — there's no Postgres in this container. I
reviewed it for ordering (backfill before NOT NULL), idempotency, and the policy
swap, but 0047 is the one thing here that has only been read, not run. Run it on
a branch/backup if you want belt and braces.

The one remaining lint error is **pre-existing** in `onboarding-form.tsx`
(`react-hooks/set-state-in-effect`) — this patch doesn't touch that file.

## Next

Goals and `profiles.limiter_profile` are still open — the prompts for both are in
the chat. Goals now has an obvious home: an event to attach "sub-1:12 at Dallas"
to. Do goals next, then the limiter.
