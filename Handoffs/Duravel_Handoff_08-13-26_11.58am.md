# Duravel Handoff — 2026-08-13, 11:58am CT

## Status: everything committed, pushed and VERIFIED LIVE

`origin/main` = **`83c86dc`**. Working tree clean apart from the roadmap HTML and handoffs.

| commit | what |
|---|---|
| `321810c` | program: one button syncs every connected source |
| `90ef53d` | engine: the plan owns liftType, and a hybrid trains every race event |
| `fd916a8` | handoffs |
| `ccf5080` | engine: a hybrid is the week's threshold session |
| `83c86dc` | hydration: pin the zone on every displayed timestamp |

Migrations 0041 + 0042 already applied. **None of this session's work needed a migration.**

## Verified live on duravel.app

1. **Sync all sources** — `Imported 9 workouts (Strava 9, Oura 0).` Both providers pulled; the link banner went (2) → (7) with no manual reload.
2. **liftType** — Fall prep regenerated: 19 Full body, 11 Power, **zero Lower body** across 16 weeks. Weeks 1 and 2 read Full / Power / Full.
3. **Race-structure hybrids** — all 8 stations in race order behind full 1000 m runs, Pro loads correct, base→build ramp confirmed (wall balls 30 → 45, skierg 300 → 425 m), timing `10/53/5 = 68 min` instead of a flat 55.
4. **Threshold substitution** — Fall prep week 1: the 5.1-mile threshold run is gone and the long run went **3.8 → 6.3 mi** on the same weekly total. Zero threshold runs remain; the hybrid carries that work.
5. **React #418** — two consecutive fresh loads of the program page: **console completely clean**.

## The intensity numbers (192-week sweep)

| | before | after |
|---|---|---|
| hard share of weekly mileage | 39.1% | **31.1%** |
| — separate quality runs | 18.3% | 10.3% |
| — inside hybrids | 20.8% | 20.8% |
| **easy** | **8.2%** | **19.6%** |
| weeks over 30% hard | 166/192 | 116/192 |

The residual 31% is roughly two-thirds hybrid — a consequence of the full-distance-runs design choice, not drift. The mileage target was deliberately NOT raised; the substitution alone restored the easy volume without adding load.

## Traps hit this session, all now in memory

- **A patch sent as a chat attachment does not apply itself.** A commit attempt found nothing staged because the patch had never been run.
- **A race between my bridge write and Levi's terminal.** His `npm test` started 90 s before the patch hit disk, so he tested the pre-patch tree and saw the old counts. **The test count is the tell** — check it matches what was promised before diagnosing anything.
- **Every git command run through the bridge leaves a `.git/index.lock`** the bridge cannot unlink, which then blocks the next local `git add`. Clear with `mv .git/index.lock _to_delete/x.bak`. I did this to myself while diagnosing.
- **A stale bundle looks exactly like a failed fix.** After pushing the hydration fix the console still threw #418 — but the chunk hash was byte-identical to the pre-fix one, which is the tell Vercel had not deployed yet. Clean ~5 min later.
- **CRLF:** `app/dashboard/page.tsx` joins `lib/generation/stations-assemble.test.ts` as a file that is CRLF on disk while its siblings are LF. Its md5 will never match `git show HEAD:`. Ship those whole, patch the rest.
- **`device_commit_files` returned a malformed schema** mid-session; `RefreshMcpTools({server:"remote-devices"})` fixed it.

## What's next, in the order I'd take it

1. **Turn the lifecycle emails on.** Built, committed and tested since 07-17; `EMAIL_ENABLED` has never been set, so it has sent nothing in four weeks. Resend is already live on `send.duravel.app` and auth email works through it. This is the largest built-but-dormant asset in the repo — wiring plus a go-live check, not a build.
2. **The 17%-over-target finding.** 90 of 540 audited weeks land over their own stated mileage, worst +4.5 mi. Pre-existing, never examined. Now more interesting: the reconciler's behaviour changed twice today.
3. **`app.duravel.app` returns Vercel 404** and the iOS Capacitor shell targets it. Hard blocker on iOS — either a domain fix or a spec change. Levi's call.
4. **Triathlon `h30_40`** peak weeks land ~490 min short. Levi to choose: bigger long-run cap at the top bands, or scale `targetMileage` down.
5. **Backlog #17** — hyresult.com scraping is a legal/ToS call; push notifications are infra; equipment + training-frequency fields are safe to build any time.
6. **Housekeeping** — the roadmap HTML has uncommitted pre-08-12 edits and has not been updated since; 3 duplicate Strava activities still need deleting by hand (no API can).
