# Duravel — Deliverables (2026-07-18)

Organized package of everything produced in this session so far.

## 1_Training_Program_Specs
Design specs scaling the training engine across all race types (reuse the
existing Base→Build→Peak→Taper skeleton; à-la-carte general-fitness mode archived).

- **Duravel_MultiSport_Strength_Architecture_Spec.md** (v4) — per-sport
  StrengthProfile dials for the DEKA family, HYROX, and triathlon.
- **Duravel_MultiDiscipline_Cardio_Composition_Spec.md** (v2) — swim/bike/run as
  first-class disciplines, brick sessions, per-discipline pacing/zones (enables
  triathlon).

## 2_iOS_App_Build
The App Store build (Capacitor native shell of the Next.js app). This is
**Part 1 of 7** — Parts 2–7 run as scheduled overnight sessions and deliver their
own files into the chat.

- **Duravel_iOS_Master_Build_Plan.md** — the 7-part program, conventions,
  architecture decisions, and preliminary morning to-do.
- **Duravel_iOS_Part1_Foundation.md** — architecture + setup detail.
- **ios-artifacts/capacitor.config.ts** — drop-in Capacitor config.
- **ios-artifacts/ios-setup.sh** — Mac bootstrap script (run in the repo root).

> Parts 2–7 (native shell, auth/deep-linking, billing, HealthKit, push,
> submission package + consolidated morning to-do) arrive hourly in the chat.
> Ask me to re-zip in the morning to fold them in.
