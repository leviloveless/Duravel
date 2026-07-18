# Duravel — App Store Screenshot Plan

Everything you need to shoot, size, and caption the App Store screenshots. Apple requires screenshots for at least the largest iPhone display; providing the 6.5" set as well maximizes coverage. If you enable iPad support, a 12.9"/13" iPad set is required too.

---

## 1. Required device sizes

App Store Connect scales down from the largest size you provide, but the two iPhone "reference" sizes are what you should shoot natively:

| Display class | Device to render on | Portrait resolution (px) | Required? |
|---|---|---|---|
| **6.9" / 6.7"** (iPhone 15/16 Pro Max, 15/16 Plus) | iPhone 16 Pro Max | **1290 × 2796** | **Required** — this is the primary/largest size |
| **6.5"** (iPhone 11 Pro Max / XS Max era) | iPhone 11 Pro Max simulator | **1242 × 2688** | Strongly recommended (covers older-frame devices) |
| **5.5"** (iPhone 8 Plus) | — | 1242 × 2208 | Optional/legacy — skip unless you want it |
| **iPad 12.9"/13"** | iPad Pro 12.9" | **2048 × 2732** | **Required only if the app supports iPad** |

**Decision for Duravel:** the Capacitor shell is an **iPhone-first** build. Recommendation: **ship iPhone-only for v1** (set the target to iPhone in Xcode → General → Supported Destinations). That removes the iPad screenshot requirement and the need to make the webview look good on a large canvas. Revisit iPad in a later version once the web layout is verified at tablet widths.

- Provide **6.7"** (1290×2796) — required.
- Provide **6.5"** (1242×2688) — recommended.
- **Skip iPad** for v1 (iPhone-only target).

Rules: 3–10 screenshots per size. First 2–3 are what users see without scrolling — make them count. No alpha/transparency, RGB, no rounded corners added by you (Apple frames them).

---

## 2. Suggested set — 6 screenshots (with optional 7 & 8)

Shoot these against the brand background `#0B0B0F`. Each has a short bold caption (overlay text) and a subcaption. Keep captions ≤ ~7 words so they read on a phone.

| # | Screen to capture | Caption (bold overlay) | Subcaption |
|---|---|---|---|
| **1** | Home / today's session with a HYROX plan loaded | **Train for race day** | Structured HYROX, DEKA & triathlon plans |
| **2** | Live/guided workout view mid-session (intervals + station work visible) | **Every rep, laid out** | Pacing, intervals, and stations step by step |
| **3** | Apple Health sync screen / permission granted state showing HR + workouts | **Synced with Apple Health** | Your plan adapts to real training load |
| **4** | Progress / stats over weeks (volume, readiness, completed sessions) | **Watch the fitness compound** | Track volume and readiness week to week |
| **5** | Plan library (HYROX / DEKA / triathlon plan cards) | **One plan for engine + strength** | From first event to podium peak |
| **6** | Paywall / membership screen (clean, prices visible) | **Membership unlocks everything** | $19.99/mo or $119.99/yr |
| 7 *(opt)* | Adaptive coaching / "we reshaped your week" state | **Adapts to real life** | Miss a session? The week adjusts. |
| 8 *(opt)* | Notification/reminder example (push) | **Never miss a session** | Smart reminders keep you on plan |

> Lead ordering matters: **1 → 2 → 3** carry the pitch for users who don't scroll. If you only ship 5, drop #6 (the paywall converts less as a hero shot) OR keep it — teams disagree; A/B later via Product Page Optimization.

---

## 3. Caption & design spec

- **Background:** brand `#0B0B0F`. Device frame in a lighter charcoal or the phone's natural bezel.
- **Caption band:** top ~22% of the frame, brand accent for the bold line, white for subcaption. Keep the app UI readable below it.
- **Font:** match the app's type; large bold headline, medium subcaption.
- **Consistency:** same caption band position and type scale across all 6 so the set reads as one story.
- **No lorem ipsum, no placeholder data** — populate real-looking plan names and numbers; Apple rejects screenshots that show obviously fake or broken states.
- **No pricing that contradicts the store** — if you show the paywall, the numbers ($19.99 / $119.99) must match the IAP products exactly.

---

## 4. How to produce them (no designer required)

1. Run the app in the **iOS Simulator** (iPhone 16 Pro Max for 6.7", iPhone 11 Pro Max for 6.5") once you have a Mac + Xcode.
2. Navigate to each screen with realistic demo data (use the review demo account).
3. Capture with **⌘S** in Simulator (saves at exact required resolution) or `xcrun simctl io booted screenshot shot1.png`.
4. Add caption bands in Figma/Sketch/Canva at the exact pixel size, export PNG (RGB, no transparency).
5. Upload per size in App Store Connect → the version → Previews and Screenshots.

**Fallback if you're short on time:** you can ship *device screenshots without caption overlays* (raw simulator captures). They're allowed and unblock submission; add polished captioned versions in a later update.

---

## 5. Optional: app preview video

Not required. If you add one later: 15–30s, portrait, same sizes, shot in-app. Skip for v1 to avoid blocking submission.

---

## 6. Checklist

- [ ] iPhone-only target confirmed (or iPad set added if you keep iPad support)
- [ ] 6.7" set (1290×2796) — 5–8 shots, RGB, no transparency
- [ ] 6.5" set (1242×2688) — same shots re-rendered
- [ ] First 3 shots carry the pitch
- [ ] Paywall screenshot prices match IAP products exactly
- [ ] Real demo data, no broken/empty states
- [ ] Captions consistent across the set
