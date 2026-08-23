# Duravel Handoff — 2026-08-13, 12:34pm CT

## Status: everything committed, pushed and verified live

`origin/main` = **`77f3e7b`**. Six commits today, all confirmed on duravel.app.

| commit | what |
|---|---|
| `321810c` | program: one button syncs every connected source |
| `90ef53d` | engine: the plan owns liftType, and a hybrid trains every race event |
| `fd916a8` | handoffs |
| `ccf5080` | engine: a hybrid is the week's threshold session |
| `83c86dc` | hydration: pin the zone on every displayed timestamp |
| `77f3e7b` | admin: the email ledger says whether email is actually sending |

Migrations 0041 + 0042 already applied. **No migration needed by any of today's work.**

## ✅ The email question is settled — and I was wrong about it

`/admin/email`, first load:

> **Sending — 14 email(s) reached Resend in the last 30 days.** 100% delivery. Last send Aug 10.
> trial_ending 11/11 · welcome 3/3 · onboarding_nudge 0 · receipt 0 · zero bounces, zero skips, zero suppressions.

**The lifecycle emails have been live and healthy since 2026-07-20.** I recommended "turn them on" off a stale MEMORY.md index line that still described the 07-17 state, without opening the topic file it pointed at. Levi accepted the recommendation before the contradiction surfaced. The index is corrected and the topic file now carries a warning at the top: **an index entry is a pointer, not a fact — open it before acting, especially when the action is irreversible.**

## 🔎 Two findings the panel surfaced on its first load

1. **`receipt` = 0 while `trial_ending` = 11.** Eleven athletes hit a trial ending in 30 days and not one receipt went out. Either nobody converted (a funnel fact worth knowing) or the `invoice.payment_succeeded` receipt hook in `app/api/stripe/webhook/route.ts` is not firing. **Check Stripe for successful invoices in that window first** — if invoices exist and receipts don't, the hook is broken.
2. **0 opens across all 14 delivered.** `delivered` advanced fine, so the Resend webhook and Svix verification work. `email.opened` simply never arrives — most likely open tracking is off in the Resend project (not on by default), or the webhook subscription omits that event.

Neither is a bug in the panel. Both were invisible before it existed.

## What shipped today, briefly

- **Sync all sources** — one program-header button pulls every connected provider. Live: `Imported 9 workouts (Strava 9, Oura 0)`.
- **liftType** — the engine owns every lift slot, not just `power`. Fall prep regenerated: zero "Lower body lift" in 16 weeks.
- **Race-structure hybrids** — all 8 events, race order, full 1 km runs, half station volume × the phase factor. Pace-aware session timing replaced a flat 55-minute proxy.
- **Threshold substitution** — a hybrid credits the week's threshold run. Hard mileage 39.1% → 31.1%, easy 8.2% → 19.6%. Fall prep week 1's long run went 3.8 → 6.3 mi on the same weekly total.
- **Hydration** — every displayed instant now formats in the athlete's stored zone. Program-page console went from a #418 on every load to silent.
- **Email health panel** — `/admin/email`.

## Traps hit today (all in memory)

- A patch sent as a chat attachment **does not apply itself**.
- A **race** between a bridge write and the local terminal — the test count is the tell.
- **Every git command through the bridge leaves a `.git/index.lock`** the bridge cannot unlink; clear with `mv .git/index.lock _to_delete/x.bak`.
- **A stale bundle looks exactly like a failed fix** — compare the chunk hash before concluding anything.
- **CRLF:** `app/dashboard/page.tsx` and `lib/generation/stations-assemble.test.ts` are CRLF while their siblings are LF. Ship those whole; patch the rest.
- **`device_commit_files` returned a malformed schema**; `RefreshMcpTools({server:"remote-devices"})` fixed it.

## Next, in the order I'd take it

1. **The two email findings above** — both are 10-minute dashboard checks before any code.
2. **The 17%-over-target finding** — 90 of 540 audited weeks land over their stated mileage, worst +4.5 mi. Never examined, and the reconciler's inputs moved twice today.
3. **`app.duravel.app` returns Vercel 404** while the iOS Capacitor shell targets it. Hard blocker; domain fix or spec change, Levi's call.
4. **Triathlon `h30_40`** peak weeks land ~490 min short — bigger long-run cap, or scale `targetMileage` at the top bands.
5. **Backlog #17** — hyresult.com scraping (legal/ToS), push notifications (infra), equipment + training-frequency fields (safe to build).
6. **Housekeeping** — the roadmap HTML has uncommitted pre-08-12 edits and hasn't been updated; 3 duplicate Strava activities still need deleting by hand.
