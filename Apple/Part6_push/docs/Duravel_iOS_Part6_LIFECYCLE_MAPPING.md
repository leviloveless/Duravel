# Duravel iOS — Part 6: Lifecycle Email → Push Mapping

> Goal: let each existing lifecycle EMAIL event optionally fire a PARALLEL push,
> with cadence unified across channels and a per-user preference respected. Push
> is **additive and optional** — email remains the source of truth; push is a
> faster, lighter nudge for users who opted in.
>
> This doc assumes the built-but-gated lifecycle email system in the repo. Where
> its internals differ, the integration point is the same: **at the moment the
> system decides to send an email for event X, also call `send-push` for the
> mapped category** (subject to the gate). One decision, two channels.

---

## 1. Principle: one cadence, two channels

The lifecycle system already decides *when* an event fires (trial ending in N
days, session due, streak at risk, plan updated). We do **not** invent a second
schedule for push. Instead, the push rides the **same trigger** as the email.
That keeps cadence unified and avoids the classic failure where a user gets an
email at 9am and an unrelated push at 3pm about the same thing.

Two integration shapes, pick one:

**(A) Inline fan-out (recommended).** Wherever the email is enqueued/sent, add a
sibling call to `send-push`. Pseudocode:

```ts
// existing lifecycle dispatcher
async function dispatchLifecycle(event: LifecycleEvent) {
  if (await emailAllowed(event.user_id, event.type)) {
    await sendLifecycleEmail(event);            // existing
  }
  // NEW — parallel, optional, independently gated:
  const pushCat = EMAIL_TO_PUSH[event.type];
  if (pushCat) {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        user_id: event.user_id,
        category: pushCat,
        notification: pushCopyFor(event),        // title/body/data.link
      }),
    });
  }
}
```

The push has its OWN gate (`push_gate` in SQL: master switch, per-category flag,
quiet hours) so a user can keep email on and push off, or vice-versa.

**(B) Event-table listener.** If the lifecycle system writes events to a table,
add a DB trigger / Realtime listener that calls `send-push`. Same mapping table,
looser coupling. Use this only if you can't touch the dispatcher.

---

## 2. The mapping

| Lifecycle email event | Push category (`notif_category`) | Deep link on tap | Cadence source | Transactional? |
|---|---|---|---|---|
| Trial ending (e.g. T-3, T-1, T-0) | `trial_ending` | `duravel://account/billing` | email trigger | Semi — see §4 |
| Workout / session reminder | `workout_reminder` | `duravel://session/{id}` | email trigger (session schedule) | No |
| Streak at-risk / milestone | `streak` | `duravel://progress/streak` | email trigger | No |
| Plan updated by coach | `plan_updated` | `duravel://program/{id}` | plan-update event | No |
| Security / billing receipt | `account` | `duravel://account/billing` | transactional | **Yes** (bypasses quiet hours) |
| Announcements / promos | `marketing` | varies | campaign | No (opt-IN) |

Notes:
- The `link` is set by the sender in `notification.data.link` and MUST be a
  `duravel://` URL so it routes through the Part 3 deep-link handler. The
  `send-push` fn back-fills a category default if omitted.
- `workout_reminder` and `plan_updated` require an id (`session_id` /
  `program_id`) in `data` so the deep link targets the right screen.

### Copy guidance (keep push shorter than email)

Push is glanceable. Title ≤ ~40 chars, body ≤ ~110. Examples:

- trial_ending (T-1): **"Your trial ends tomorrow"** — "Keep your programs and history — pick a plan in a tap." → billing
- workout_reminder: **"Leg day at 6:00pm"** — "Your session's ready when you are." → session
- streak (at-risk): **"Don't break your 12-day streak"** — "A quick session keeps it alive." → streak
- plan_updated: **"Coach updated your plan"** — "New week's programming is live." → program

---

## 3. Per-user preference model

Preferences live in `notification_preferences` (see
`Duravel_iOS_Part6_notification_prefs.sql`). Relevant fields:

- `push_enabled` — master push kill switch.
- `push_trial_ending`, `push_workout_reminder`, `push_streak`,
  `push_plan_updated`, `push_marketing` — per-category opt-in.
  (`marketing` defaults OFF — opt-in only.)
- `quiet_hours_enabled`, `quiet_start`, `quiet_end`, `timezone`.
- `email_enabled` — mirrors the existing email master so a single Settings
  screen can present both channels side by side.

**Keeping channels unified in the UI:** present a matrix — rows = event
categories, columns = Email / Push — so the user sets each once. The email
column maps to the existing email prefs; the push column maps to the fields
above. This makes "same cadence, choose your channel" obvious.

The `send-push` fn calls `push_gate(user_id, category)` which returns
`send | suppressed_pref | suppressed_quiet`, so all gating is centralized and
testable in SQL — the email side keeps using its own allow-check.

---

## 4. Quiet hours & the trial-ending exception

- Non-urgent categories (`workout_reminder`, `streak`, `plan_updated`,
  `marketing`) respect quiet hours. During quiet hours the fn **defers** the
  push to `quiet_end` (via `scheduled_pushes` + a cron worker) rather than
  dropping it, unless the caller sets `dropIfQuiet: true`.
- `account` (security/billing receipts) is transactional and bypasses quiet
  hours (still respects `push_enabled` + OS permission).
- **trial_ending is semi-urgent.** Recommended policy: respect quiet hours for
  T-3/T-1 (defer to morning) but allow T-0 ("ends today") to bypass by passing
  `respectQuietHours: false` on the final notice. This mirrors how the email
  system escalates the final reminder. Set this per-trigger in the dispatcher.

Deferral requires `Duravel_iOS_Part6_scheduled_pushes.sql` + a cron worker
(pseudocode included there). If you skip deferral, quiet-hours pushes are simply
suppressed — no user harm, just no late-night nudge.

---

## 5. Unsubscribe / preferences note

Compliance and good-citizen behaviour:

1. **In-app Settings** is the primary control: the Email/Push matrix in §3.
   Every push category is individually toggleable; `push_enabled` is a global
   off. Changes write to `notification_preferences` via the owner-only RLS
   policies — no server round-trip needed beyond the normal Supabase update.
2. **OS-level control** always wins: if the user turns off notifications in iOS
   Settings, nothing we do can override it. Detect `denied` on launch and show a
   gentle "Notifications are off in iOS Settings" banner with a deep link to
   `UIApplication.openSettingsURLString` (surface via a small native shim or the
   `@capacitor/app` + `App.openUrl`), rather than re-prompting (iOS forbids it).
3. **Marketing is opt-IN** (`push_marketing` defaults false) — never send
   promotional pushes without an explicit toggle-on. Transactional categories
   (`account`) are not subject to marketing consent but still honor the master
   switch and OS permission.
4. **Email unsubscribe stays independent.** Turning off a push category does NOT
   unsubscribe the user from the matching email, and vice-versa — that's the
   point of the two-column matrix. The existing email unsubscribe link/flow is
   unchanged by this part.
5. **Audit trail:** `notification_preferences.updated_at` records the last
   change. If you need per-change history for compliance, add an append-only
   `notification_pref_events` log (not included here; note for later).

---

## 6. Rollout recommendation

1. Ship the schema (`push_tokens`, `notification_preferences`,
   optionally `scheduled_pushes`) + edge fn first, unwired.
2. Wire registration + tap routing in the shell; verify tokens land and taps
   route (Part 3 handler) with manual `send-push` calls.
3. Add the Settings matrix so users have controls BEFORE any lifecycle push
   fires.
4. Enable the inline fan-out one category at a time, starting with
   `workout_reminder` (highest value, clearly wanted) and `plan_updated`.
   Hold `trial_ending` push until you're comfortable with the T-0 bypass policy.
5. Keep `marketing` off until there's a real campaign + explicit opt-in UI.
