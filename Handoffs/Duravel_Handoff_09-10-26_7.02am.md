# Duravel handoff — 09-10-26, 7:02am

Everything from this run is **pushed**. `origin/main` = `6e896dc`. Nothing outstanding.

## What shipped

    6e896dc  a bike, and sizes the athlete sets
    d4c51e6  caps that hold, and a render loop in the week designer
    67efdb7  eight parallel investigations, and the save-hang fix
    4082746  refuse a race date the year 226
    f40223e  undo in the week designer, and a brick you can author
    d1799f0  empty _to_delete
    6da7cb1  hours win: a capped-out week lands short and says so
    3746fa4  custom tier (pushed earlier)
    3bcd47b  volume grows by sessions (pushed earlier)

1,589 tests, `tsc`, `next build`, and ESLint — which runs again for the first time
in a while.

## The custom program builder

It now has Undo (every edit, twenty deep), a **Brick**, a **Bike**, **Lift —
power**, and a **starting size** on every run, bike and brick.

The sizes are the important one, because they bend the rule the tier was built
on — *the template says what and where, never how much*. They were allowed to
because the number is **week one only** and every guard still binds:

- Your figure is stored as a **share of the week**, so it ramps, deloads and
  tapers instead of sitting at eight miles for sixteen weeks.
- It is applied **inside the run's legal band**. Ask for a 40-mile long run and
  you get one that still meets the 90-minute ceiling. Ask for a threshold session
  that is a third of your week and you get about a fifth, because the quality
  share is a guard and typing a bigger number does not move it.
- A sized run is never raided to feed another, and it is the last thing dropped
  when a week cannot hold everything.

If those stop being true, the feature has become the thing the rule existed to
prevent. That is the line to watch.

## Three bugs worth remembering

**Your three bug reports were one typo.** The A race was stored as `0226-11-21`
— year 226. From there: the race floors to week 1 and shows on your start date,
`durationWeeks` takes the furthest race and leaves only the B race four weeks
out, and an A-race week belongs to the taper protocol so your authored days are
discarded by design. The root cause is structural: the onboarding form blocks
native submit on purpose, which also blocks native validation, so every `min`
and `max` in its 1,700 lines was decorative. Now closed across the whole form —
dates, 5K times, pace overrides, heart rates, custom zone bands.

**"The back link isn't working" was an infinite render loop**, and it was mine
from extracting the grid that morning. No crash, no console warning — the page
just stops responding to everything and you notice one control.

**Every planned swim, ride and brick was being thrown away.** `daySessions`
filtered the engine's planned slots to run/lift/hybrid, so a 70.3 week that
planned two swims, two rides, a brick and two runs shipped one run and six
anonymous cardio blocks. No test asserted that a planned session reaches the
athlete. This also killed the "triathlon h30_40 is ~490 minutes short" backlog
item — that number was a HYROX week, mislabelled in August.

## Caps

Your instruction was "as the hours go up, the max session length needs to
increase". Measured first, and the caps were **not** the constraint — nothing
was at its ceiling. The mileage floor was buying day-slots with sessions and
leaving one slot for the Zone 1-2 work a 26-hour week is made of. Reserving
slots by band took h20_30 from 54% to 82% delivery and h10_20 to 92%.

Triathlon's phase caps were computed, applied, then discarded by the rescaler:
634 runs past their cap, a 290-minute *easy* run in an Olympic-distance program,
the long run not the longest in 40% of weeks. All zero now, swim included.

## What's on you

1. **Live-verify the builder** — Undo, Bike, Lift-power, the size boxes.
2. **Create the $39.99 Stripe price** → `STRIPE_PRICE_CUSTOM_MONTHLY`. It now
   shows a truthful "coming soon" instead of a 500, and setting the price id
   ships the plan — there is no second flag to remember.
3. **Confirm the swim caps** (Olympic 75 / 70.3 90 / 140.6 120 at peak). They are
   the least-measured numbers in the caps work.

## Next in the queue

The week designer in **onboarding** — the grid is extracted and ready; what is
missing is the toggle at sport selection, a "Your week" step at the end, and
carrying the template into the first generate so a custom program is built right
the first time instead of generated and immediately rebuilt.
