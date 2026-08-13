# Duravel Verification — 08-03-26 9:25am

Retest of `d7b8dda` on a fresh no-rest-day program ("Rest day fix test"). No code changed this round.

## Result — the rest-day fix worked

Weeks 8 and 15, the two non-deload weeks that were failing, are now correct:

    week 8   mon cardio(30)  tue cardio(30)  wed run+cardio  thu hyb+run  fri lift+cardio  sat run+lift  sun hyb+lift
    week 15  mon cardio(30)  tue lift+cardio  wed run  thu cardio(30)  fri lift+cardio  sat run  sun cardio

Monday in week 8 was empty before; it and Thursday/Sunday in week 15 were empty. Every day is now in use.

Across all 16 weeks:

- **No day has two filler blocks.** Clean.
- **Empty day beside a doubled day**: only weeks 3, 6 and 9 — all Deload. Expected and correct per the athlete's decision that empty days on a deload are rest, not a defect.
- **Three-day aerobic gaps**: week 3 (Deload) and weeks 7/10/16 (Race weeks — taper). Expected.
- **Weekend biggest**: holds everywhere except week 11. Weeks 7/10/16 register as failures only because the weekend total is 0 on a race week — vacuous.

## Week 11 — a genuine limit, not a bug

    mon cardio(30)  tue run+cardio(130)  wed run(45)  thu hyb+run(100)
    fri lift+cardio(90)  sat run+lift(109)  sun hyb+lift(115)

Tuesday at 130 exceeds Sunday at 115. `keepPreferredDaysBiggest` cannot fix it: both weekend days already hold two sessions, so there is no room to add or grow a filler block there, and the only alternative — shrinking Tuesday without growing the weekend — would break the exact-cardio-total guarantee.

Structurally unfixable without either raising the 2-session-per-day cap on the weekend or accepting a volume error. Left as is.

## The ranked trade-off is visible

Nine weeks have a lift day with no cardio while another day carries two aerobic sessions. That is priority 3 (pair the lift days) yielding to priorities 1 and 2, exactly as ranked — not a defect. Worth a look if the athlete wants to revisit the ordering, since it is the most common remaining pattern.

## Onboarding copy

Confirmed live on the builder: the new rest-day guidance renders and the old "Rest days are kept clear when your schedule leaves room" text is gone.
