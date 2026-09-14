# Duravel Handoff — 09-13-26, 3.27pm ET

## One patch, one migration. Nothing is pushed.

**Patch:** `duravel_full_0913.patch` (repo root) — applies cleanly on `a7a5a9f`.
**Migration:** `supabase/migrations/0046_signup_profile.sql` — the only one.

> ⚠️ **Delete the earlier `duravel_signup_0913.patch` from the repo root.** It is
> superseded — this patch contains everything it did, plus the rest. Applying
> both will conflict.

### Apply

```
cd C:\dev\duravel
del duravel_signup_0913.patch
git status                                   # confirm a clean tree at a7a5a9f
git apply --check duravel_full_0913.patch    # must print nothing
git apply duravel_full_0913.patch
npm install                                  # next/font pulls three Google faces at BUILD time
npm run build                                # THE ONE THING I COULD NOT VERIFY — see below
npm run test                                 # expect 150 files / 1749 tests
```

Then apply migration **0046** in Supabase, **before** deploying — `/signup`,
`/setup` and `/dashboard` all read columns it adds.

### What I could not verify, and why

`app/layout.tsx` now uses `next/font/google` (Archivo · Saira Condensed · IBM
Plex Mono). **This cloud container's egress blocks fonts.googleapis.com**, so
`next build` cannot complete here — it fails on the font fetch and nothing else.
I proved the build green with the fonts stubbed out: all 25 routes compile.
Vercel's build network is unrestricted, so this should just work, but it is the
single unverified line in the patch. If it ever bites, self-host the woff2 files
under `public/fonts/` and switch to `next/font/local` — better anyway, since it
removes a build-time dependency on Google's CDN.

`/setup`, `/start` and `/dashboard` render only for a signed-in athlete, so I
typechecked and built them but could not screenshot them. `/signup`, `/login`,
`/library` and `/refunds` I did render and look at.

## The bug this work uncovered

**The 14-day trial did not start at signup.** `trial_started_at` defaults to
`now()` on the `profiles` row (migration 0015), and until 0046 exactly one thing
created that row: onboarding, at first program generation. So:

- the clock began at **first program**, not at account creation — sign up in
  March, generate in September, get a fresh 14 days in September;
- anyone who signed up and never onboarded had **no `profiles` row at all**,
  making them invisible to everything that reads that table — **including the
  onboarding-nudge email, whose entire audience is exactly those people.**

This is the fifth instance of the repo's recurring shape: a decision the system
believes it has made, silently not reaching the athlete because of where the
wiring put it.

## Decisions you made, now built

| | |
|---|---|
| Annual refund window | **14 days** — written into `/refunds` |
| Apple IAP vs external billing | **Stripe on the web, no IAP** — see below |
| Usernames | **Dropped** |
| Google + Apple sign-in | **Both wired** |

**Why no IAP.** Guideline **3.1.1(a)** now reads: *"these entitlements are not
required for developers to include buttons, external links, or other calls to
action in their United States storefront apps."* The link-out prohibition does
not apply on the US storefront and needs no entitlement. Duravel launches
US-only, so the iOS app can simply link to Stripe. IAP was rejected because it
would put **a second source of entitlement truth beside the Stripe webhook,
which is deliberately the only writer of it** — plus receipt validation, a
reconciliation path, and Apple's cut of every $19.99.
⚠️ **Revisit before selling outside the US**, where the External Purchase Link
Entitlement is required per region, or IAP is mandatory.

## What shipped

**Routes:** `/signup` · `/start` · `/setup` · `/library` · `/refunds`, and
`/dashboard` rebuilt. Plus the first global footer.

- **`/signup`** — name, email, sport, sex, password, date of birth, one checkbox
  consenting to all three policies. Google and Apple above the fold.
- **`/start`** — three paths, one live. Coaching links to the existing waitlist.
- **`/setup`** — five steps. **Step 3 is benchmarks, not device pairing**, on
  purpose: a watch is a nice-to-have, a benchmark is the thing the engine cannot
  run without.
- **`/library`** — 70 sessions filed by **goal, not body part**, because that is
  already the engine's taxonomy (`emphasis` on a lift, `runType` on a run).
- **`/dashboard`** — race countdown, four tiles, week strip, planned-vs-completed
  hours, intensity vs the 20/60/10/5/5 target, and **station benchmarks against
  the F/C bands from `lib/engine/hyrox-standards.ts`**. That last one is the
  differentiator: an athlete knows their wall-ball time, but not that 6:45 is
  mid-pack while their 1:58 farmers carry is nearly elite.

### Traps avoided, deliberately

- **Every duration goes through `sessionTiming().total`.** `durationMin` on a run
  is the main set only; reporting work minutes would have understated every
  athlete's week by about a third while looking entirely plausible. There is a
  test that fails if it comes back.
- **Zone mix is computed from the sessions, not `week.summary.zoneDistribution`.**
  Two surfaces reading different sources eventually disagree in front of someone.
- **`signUp` was DELETED from `app/login/actions.ts`, not deprecated.** A server
  action is reachable whether or not a page renders a form for it; leaving it was
  a second door creating accounts with no name, no age gate, no consent record.
- **`ensureProfileFromSignup` no-ops when a row exists.** `/auth/confirm` is
  re-entered by email scanners and double-clicks; re-running it must never reset
  a trial.
- **Signup answers travel as auth metadata, not a service-role insert.** The
  Stripe webhook stays the only service-role writer.
- **Migration 0046 relaxes seven NOT NULLs — measured, not assumed.** Outside the
  row type, every reader of those seven is a form prefill already written
  `profile?.x ?? fallback`, and the engine reads `input_snapshot`, never these.

### Two tests that caught real design flaws

- The station **focus** rule originally took the bottom three unconditionally —
  which flagged all three benchmarks of an athlete who had three, and told an
  evenly-developed athlete to work on stations that were not weak. It now flags
  only stations below that athlete's own mean.
- The date-of-birth parser rejects a two-digit year **before** checking the
  calendar, so "99" reports the real mistake. This is the year-0226 bug again,
  and here it would have let a child past the age gate or locked an adult out.

## Still yours

1. **Apply migration 0046**, then deploy.
2. **Enable the Google provider in Supabase**, or the button returns a provider
   error (the page catches it and says so rather than blank-redirecting).
3. **Apple sign-in stays dark until Developer Program enrolment clears** — an
   existing blocker. Guideline 4.8 makes it mandatory *because* Google ships.
4. **Read `/refunds`.** California's Automatic Renewal Law has pre-checkout
   disclosure and cancellation-flow obligations that bite on a monthly plan sold
   to US consumers. You are the lawyer.
5. **`support@duravel.app` is still unconfirmed as a monitored mailbox** — now on
   a third page.
6. `duravel.app/ios` is a real encoded QR on the welcome step and **that route
   does not exist yet**. Point it at a TestFlight or notify page before launch.
