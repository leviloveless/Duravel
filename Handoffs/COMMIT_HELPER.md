# Commit helper — signup / setup / library / dashboard

## 1. Stage only this work

`git add -A` would sweep in your own uncommitted files. Stage explicitly:

```
git add \
  app/auth/confirm/route.ts \
  app/dashboard/page.tsx \
  app/globals.css \
  app/layout.tsx \
  app/library/page.tsx \
  app/login/actions.ts \
  app/login/login-form.tsx \
  app/privacy/page.tsx \
  app/refunds/page.tsx \
  app/setup/actions.ts \
  app/setup/page.tsx \
  app/setup/setup-wizard.tsx \
  app/signup/actions.ts \
  app/signup/page.tsx \
  app/signup/signup-form.tsx \
  app/start/page.tsx \
  app/terms/page.tsx \
  components/dashboard/charts.tsx \
  components/dashboard/this-week-card.tsx \
  components/dashboard/week-strip.tsx \
  components/library/library-browser.tsx \
  components/nav-bar.tsx \
  components/site-footer.tsx \
  lib/dashboard/derive.test.ts \
  lib/dashboard/derive.ts \
  lib/library/types.ts \
  lib/library/workouts.test.ts \
  lib/library/workouts.ts \
  lib/push/triggers.ts \
  lib/signup-checks.test.ts \
  lib/signup-checks.ts \
  lib/signup-profile.ts \
  public/ios-qr.svg \
  supabase/migrations/0046_signup_profile.sql
```

Deliberately NOT staged — these are yours:
`.env.example`, `lib/engine/stations.ts`, `lib/engine/hybrid-run-floor.test.ts`, `Tasks/`,
and the three loose `.patch` files plus `Handoffs/0046_signup_profile.sql`.

## 2. Check before committing

```
git status --short
git diff --cached --stat
```

Expect **34 paths**. Nothing of yours should appear as staged.

## 3. Commit

Save the message below as `msg.txt`, then `git commit -F msg.txt`.

```
a signup that collects an athlete, and the three screens after it

Account creation was a text toggle on /login that took an email and a
password. It now has its own route, collects what the engine and the
Terms actually need, and records what was agreed to — and /start, /setup
and /library follow it, with /dashboard rebuilt around the numbers an
athlete acts on.

THE TRIAL DID NOT START AT SIGNUP. `trial_started_at` defaults to now()
on the profiles row (0015), and until 0046 exactly one writer created
that row: onboarding, at first generation. So the 14-day clock began at
first program, not at account creation, and anyone who signed up without
onboarding had no row at all — which also made them invisible to the
onboarding-nudge email, whose entire audience is those people.

Migration 0046 drops NOT NULL on the seven columns only onboarding can
fill. Measured before changing: outside the row type, every reader of
those seven is a form prefill already written `profile?.x ?? fallback`,
and the engine never reads them from here — it reads the program's
input_snapshot. `age` stays (31 call sites) but is derived from a new
date_of_birth, because an age integer is wrong within a year of being
stored.

The signup answers travel as auth-user metadata and become a row at
/auth/confirm, where a session exists. The alternative was a service-role
write from the signup action, and the Stripe webhook is deliberately the
only service-role writer. The insert no-ops when a row already exists —
/auth/confirm is re-entered by email scanners and double-clicks, and
re-running it must never reset someone's trial.

Removed signUp from app/login/actions.ts rather than deprecating it. A
server action is reachable whether or not a page renders a form for it,
and leaving it would have left a second door creating accounts with no
name, no age gate and no consent record.

/setup is five steps and step three is BENCHMARKS, not device pairing. A
watch is a nice-to-have; a benchmark is the thing the engine cannot run
without. Every step saves on its own, so closing the tab at step three
keeps the first two, and saveBenchmarks read-modify-writes because the
HYROX lookup may already have written eight splits into that column.

The library is 70 sessions filed by GOAL, not body part, because that is
already the engine's taxonomy — emphasis on a lift and runType on a run
answer the same question.

The dashboard's derivations are pure and tested. Every duration goes
through sessionTiming().total: on a run, durationMin is the main set
only, and reporting work minutes would have understated every athlete's
week by about a third while looking plausible. Zone mix is computed from
the sessions, not the stored week.summary snapshot. The station-band
chart normalises each split against the same F/C table the projection
model uses, so the two cannot tell different stories.

Billing stays on Stripe on the web. Guideline 3.1.1(a) exempts the
United States storefront from the external-link prohibition with no
entitlement required, and IAP would mean a second source of entitlement
truth beside the webhook that is currently the only writer of it.

Date fixtures use the local constructor, never Date.UTC — the latter is
the previous calendar day west of Greenwich, and the age-gate assertions
read a year young in America/New_York while passing in a UTC container.
Suite verified under UTC, New York, Chicago and Sydney.

Tests pass, typecheck clean, lint clean on everything touched.
```

## 4. Tidy up

The patch files and the loose migration copy have done their job:

```
del duravel_full_0913.patch duravel_tz_fix_0913.patch
del Handoffs\0046_signup_profile.sql
```

(The real migration lives at `supabase/migrations/0046_signup_profile.sql` and is staged above.)

## 5. Push — yours to run

```
git push
```

Then watch the first Vercel deploy for the `next/font` fetch, the one thing
never verified from the cloud container.
