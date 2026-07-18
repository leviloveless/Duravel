# Duravel — App Store Connect Metadata

Drop-in copy for App Store Connect → **App Information** and the version's **Product Page**. Every field below is written to fit Apple's character limits; where a field has a hard limit the current character count is noted in `[brackets]`. Paste as-is, or tune wording — but keep within the noted limits or App Store Connect will reject the field.

---

## 1. App name & subtitle

| Field | Value | Limit |
|---|---|---|
| **App Name** | `Duravel` | 30 chars — using 7 |
| **Subtitle** | `Hybrid endurance training` | ≤30 chars — 25 |

Subtitle alternatives (all ≤30 chars, pick one):

- `Hybrid endurance training` — [25]
- `HYROX, DEKA & triathlon plans` — [29]
- `Live hybrid race training` — [25]

> Note: Do **not** put "HYROX", "DEKA", or "Ironman/triathlon" brand names in the **app name** — Apple flags third-party trademarks in the name field. They are fine in subtitle/keywords/description as descriptive references, but see the trademark note at the bottom.

---

## 2. Promotional text (≤170 chars, editable any time without review)

`Train for your next hybrid race with structured HYROX, DEKA and triathlon plans. Live sessions, Apple Health sync, and coaching that adapts to you.` [147]

Alt (seasonal / launch):

`New: adaptive plans that adjust to your Apple Health data. Start your first week free and build real hybrid-endurance fitness.` [125]

---

## 3. Description (≤4000 chars)

```
Duravel is the training app built for hybrid-endurance athletes — the people chasing a HYROX finish line, a DEKA badge, or their first triathlon.

Instead of generic workouts, Duravel gives you structured, periodized plans that blend running, functional strength, and the exact stations you'll face on race day. Every plan adapts around your schedule and your Apple Health data, so the work you do this week sets up the work you do next week.

WHAT YOU GET

Structured race plans
Follow proven programs for HYROX, DEKA, and triathlon — from your first event to a podium peak. Each block is periodized with clear intent: build, sharpen, taper, race.

Live and guided sessions
Run your workouts with pacing, intervals, and station work laid out step by step. Know exactly what to do, how hard, and for how long.

Apple Health integration
Duravel reads your workouts, heart rate, and activity from Apple Health to keep your plan honest and adjust load when you need recovery. Your data stays yours.

Progress that means something
Track completed sessions, volume, and readiness over time so you can see the fitness compounding week over week.

Coaching that adapts
Miss a session or feel wrecked? Duravel reshapes the week around real life instead of guilt-tripping you into overtraining.

WHO IT'S FOR

- HYROX athletes preparing for the 8 stations and the runs between them
- DEKA competitors training for DEKA STRONG, MILE, and FIT
- Triathletes building swim-bike-run durability
- Anyone who wants one plan that respects both engine and strength

MEMBERSHIP

Duravel is a subscription. A membership unlocks full access to all plans, live sessions, and adaptive coaching.

- Monthly: $19.99/month
- Annual: $119.99/year (best value)

Prices are shown in your local currency at purchase. Payment is charged to your Apple ID account at confirmation. Subscriptions renew automatically unless auto-renew is turned off at least 24 hours before the end of the current period. Manage or cancel anytime in your App Store account settings.

Start training with intent. Show up on race day durable.

—

Terms of Use: https://duravel.app/terms
Privacy Policy: https://duravel.app/privacy
Support: https://duravel.app/support
```

> The subscription disclosure paragraph is required by Apple guideline 3.1.2 for auto-renewable subscriptions. Keep it in the description. The exact renewal language must also appear on the paywall inside the app (Part 4 billing) and be linked to your Terms and Privacy.

---

## 4. Keywords (100-char field, comma-separated, NO spaces after commas)

`hyrox,deka,hybrid,endurance,triathlon,training,workout,running,fitness,coach,race,strength,plan` [93]

Rules applied:
- No spaces after commas (spaces waste characters).
- Singular forms only — Apple auto-matches plurals.
- Do **not** repeat words already in the app name/subtitle ("Duravel", "training" — note: "training" appears in subtitle option; if you ship the "Hybrid endurance training" subtitle, drop `training` from keywords and reclaim 9 chars).

Reclaimed variant if subtitle = "Hybrid endurance training":

`hyrox,deka,hybrid,endurance,triathlon,workout,running,fitness,coach,race,strength,plan,cardio` [92]

---

## 5. URLs & routing

| Field | Value |
|---|---|
| **Support URL** (required) | `https://duravel.app/support` |
| **Marketing URL** (optional) | `https://duravel.app` |
| **Privacy Policy URL** (required) | `https://duravel.app/privacy` |
| **Terms of Use (EULA)** | `https://duravel.app/terms` (or use Apple's standard EULA) |

> ⚠️ Confirm each of these pages actually resolves and renders before submission — a dead Support or Privacy URL is a common, avoidable rejection. The Privacy Policy page must describe health-data handling explicitly (see privacy nutrition-label mapping).

---

## 6. Category

| Field | Value |
|---|---|
| **Primary Category** | Health & Fitness |
| **Secondary Category** (optional) | Sports |

---

## 7. Age rating questionnaire answers

Answer the App Store Connect age-rating questionnaire as follows. Expected result: **4+** (no objectionable content). Health & fitness apps that don't offer medical advice generally land at 4+.

| Questionnaire item | Answer |
|---|---|
| Cartoon or Fantasy Violence | None |
| Realistic Violence | None |
| Prolonged Graphic or Sadistic Realistic Violence | None |
| Profanity or Crude Humor | None |
| Mature/Suggestive Themes | None |
| Horror/Fear Themes | None |
| Medical/Treatment Information | None — Duravel provides fitness training, **not** medical advice. If you add any injury/rehab guidance later, revisit this. |
| Alcohol, Tobacco, or Drug Use or References | None |
| Simulated Gambling | None |
| Sexual Content or Nudity | None |
| Graphic Sexual Content and Nudity | None |
| Contests | None |
| Unrestricted Web Access | **No** — the app loads only your own domain (app.duravel.app) in a controlled webview, not an open browser. |
| Gambling and Contests | No |
| Made for Kids | **No** — set the "This app is not designed for kids" / age band appropriately; target audience is adults 18+. |

Also under **App Privacy** and **Content Rights**: confirm you have rights to all content shown (you do — it's your own product). Under **Government / regulated**: No.

---

## 8. Trademark note (read before submitting)

"HYROX", "DEKA", and "IRONMAN/triathlon" event names are third-party trademarks. Using them **descriptively** ("training plans for HYROX") in the description/keywords is standard and generally acceptable, but:

- Keep them **out of the app name**.
- Do not imply official affiliation, licensing, or endorsement by those event organizers.
- If Apple's review or the trademark holder objects, be ready to soften to generic phrasing ("hybrid fitness racing", "functional endurance events"). Have a fallback keyword set ready: `hybrid,endurance,functional,fitness,workout,running,strength,triathlon,race,coach,plan,cardio`.

---

## 9. What's New (version notes) — first release

`First release of Duravel for iPhone. Structured HYROX, DEKA, and triathlon training with Apple Health sync and adaptive coaching. Thanks for training with us — send feedback at duravel.app/support.`
