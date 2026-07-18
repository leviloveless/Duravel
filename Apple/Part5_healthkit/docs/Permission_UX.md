# Duravel iOS — Part 5: HealthKit Permission UX

**Goal:** maximize the share of users who grant Apple Health access, without
being dark-patterny, and handle the iOS quirk that **read denials are invisible**.

---

## 1. Why an explain-before-prompt (priming) screen

The native HealthKit sheet appears **exactly once per data type, ever** (unless
the user manually re-enables in Settings → Health → Data Access & Devices). If a
user taps "Don't Allow" because they didn't understand *why*, we cannot re-prompt
— we can only deep-link them to Settings, which is high-friction.

So we **prime first**: a Duravel-branded screen that explains the value and what
we'll read, with a clear "Connect Apple Health" button. Only when the user taps
that do we call the native sheet. Users who aren't ready can dismiss without
ever "spending" the one-shot native prompt.

This is Apple's own recommended pattern and does **not** violate guidelines as
long as the priming screen is honest and the native sheet is still the actual
gate.

---

## 2. The flow

```
Onboarding / Settings "Connect Apple Health" entry point
        │
        ▼
[ isAvailable() ]  ──false──►  Show "Apple Health isn't available on this device"
        │ true                  (iPad-only / Simulator / non-iOS) — hide the CTA
        ▼
┌─────────────────────────────┐
│  PRIMING SCREEN             │  (explain value + list data + privacy line)
│  [ Connect Apple Health ]   │  [ Not now ]
└─────────────────────────────┘
        │ taps Connect
        ▼
[ requestAuthorization() ]  →  native HealthKit sheet (per-type toggles)
        │ resolves (granted flag = sheet handled; read grants NOT knowable)
        ▼
[ enableAutoSync() ]  →  register background delivery + listener
        │
        ▼
[ syncNow() ]  →  pull existing recent workouts, ingest
        │
        ▼
┌─────────────────────────────┐
│  RESULT STATE               │
│  • found workouts → "Synced N workouts / We'll keep your training up to date"
│  • none yet       → "Connected. New Apple Watch workouts will appear here."
└─────────────────────────────┘
```

### Handling the invisible-denial problem
iOS never tells us if the user denied a **read** type. After `requestAuthorization()`
resolves, we **cannot** show "you denied X". Instead:
- Immediately run `syncNow()`. If workouts come back → clearly connected.
- If nothing comes back, show a **neutral** state: *"Connected. New workouts
  from Apple Watch will show up automatically. Nothing yet — record a workout
  or check that Duravel has access in the Health app."* with a secondary
  **"Open Health settings"** button (deep link, see §4).
- Never assert "permission denied" — the user may simply have no data.

---

## 3. Copy for the priming screen

**Title:** Connect Apple Health

**Subtitle:** Bring your training and recovery into Duravel automatically.

**Body / what we read (icon list):**
- **Workouts** — runs, rides, strength, HYROX, and more sync into your log
- **Heart rate & HRV** — so your coach can read effort and recovery
- **VO2 max & resting heart rate** — track fitness trends over time
- **Calories & distance** — complete the picture of each session

**Privacy line (always visible):** Your health data stays private, is only used
to power your Duravel training, and is never sold. You choose what to share on
the next screen.

**Primary button:** Connect Apple Health
**Secondary:** Not now

Notes:
- The bullet list should **mirror the Info.plist string and the native sheet**
  so there are no surprises when the sheet appears.
- "You choose what to share on the next screen" sets the expectation that the
  native sheet has per-type toggles.

---

## 4. Deep link to Health settings (recovery path)

When a user needs to grant/adjust access after the one-shot prompt is spent,
send them to the Health app's data-access screen. Use the standard settings URL:

```ts
import { App } from '@capacitor/app';
// Opens iOS Settings for Duravel; from there the user reaches Health access.
window.open('app-settings:', '_system');
```

For a more direct route you can attempt the Health app's source screen
(`x-apple-health://`), but it is not a documented universal link and may change;
`app-settings:` is the reliable fallback. Pair the button with one line of
guidance: *"In Settings, open Health → Data Access & Devices → Duravel to turn
categories on."*

---

## 5. Device / environment guardrails (must implement)

- **Gate the whole feature on `duravelHealth.isAvailable()`** — it returns false
  on the Simulator, iPad-only installs, and non-iOS. When false, hide the
  "Connect Apple Health" CTA entirely (don't show a dead button).
- **Testing requires a real iPhone**, ideally paired with an Apple Watch, to see
  workouts/HRV/VO2max and to verify background delivery actually wakes the app.
- **First launch:** don't auto-prompt on app open. Trigger the priming screen
  from onboarding step "Connect your devices" or from Settings → Integrations,
  where the user has context.

---

## 6. Where this plugs into the app

- Priming screen component delivered as
  `Duravel_iOS_Part5_HealthKitPrimingScreen.tsx` (React; adapt to Duravel's
  component system / design tokens).
- It calls the single service surface:
  `import { duravelHealth } from '@/native/health/healthkit.service'`.
- After a successful connect, call `enableAutoSync()` then `syncNow()` as shown
  in the flow.
