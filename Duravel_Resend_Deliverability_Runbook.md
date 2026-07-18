# Duravel — Runbook: Resend + Domain Deliverability

_Created: July 14, 2026 · Est. time: ~30 min setup + ~2–4 weeks passive warm-up_
_Do this EARLY. Verification is quick, but a new sending domain needs weeks of low-volume history before the SLC surge (Sep 19). Start now — target domain verified and warming by early August._

---

## Why a subdomain

Send from **`send.duravel.app`**, not the root `duravel.app`. This isolates your email-sending reputation from your main domain — if something ever goes wrong with deliverability, it doesn't poison `duravel.app`. Resend explicitly recommends this.

`EMAIL_FROM` becomes something like: `Levi at Duravel <levi@send.duravel.app>`.

---

## Step 1 — Add the domain in Resend (~5 min)
1. Create a Resend account → **Domains → Add Domain**.
2. Enter **`send.duravel.app`**.
3. Resend generates a set of DNS records (SPF/MX, DKIM, and a DMARC option). Keep that tab open.

## Step 2 — Add the DNS records (~10 min)
Add these wherever **duravel.app's DNS is managed** (Vercel Domains if the domain is on Vercel, otherwise your registrar). Copy the exact values Resend shows — the ones below are the shape, not the literal values:

| Purpose | Type | Host/Name | Value |
|---|---|---|---|
| SPF | TXT | `send` (→ send.duravel.app) | `v=spf1 include:...resend... ~all` |
| Bounce/feedback | MX | `send` | `feedback-smtp.<region>.amazonses.com` (priority 10) |
| DKIM | TXT | `resend._domainkey.send` | long public key from Resend |
| DMARC | TXT | `_dmarc.send` | `v=DMARC1; p=none; rua=mailto:you@duravel.app` |

Notes:
- Start DMARC at `p=none` (monitor-only). Once you see clean SPF/DKIM alignment in reports for a couple weeks, you can move to `p=quarantine`.
- If your DNS provider auto-appends the domain, enter just the host part (`send`, `resend._domainkey.send`, `_dmarc.send`) — don't double the domain.

## Step 3 — Verify (~5 min + propagation)
1. Back in Resend, click **Verify DNS Records**.
2. It can take minutes to a few hours (up to 72h) to go green. Recheck periodically.

## Step 4 — Wire the app + secrets (~5 min)
Add to Vercel env (and local `.env.local`), and validate in `lib/env.ts`:
```
RESEND_API_KEY=re_...                       # from Resend → API Keys (server only)
EMAIL_FROM="Levi at Duravel <levi@send.duravel.app>"
CRON_SECRET=<random-32+ char string>        # guards /api/cron/email
```
(`SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SITE_URL` already exist and are reused.)

## Step 5 — Warm up (passive, ~2–4 weeks)
Don't import an old list and blast it. Instead:
- Let the **welcome email** carry early volume as leads trickle in from build-in-public + the free tool through August. Welcome emails have the highest open/engagement, which builds reputation fastest.
- Keep daily volume low and steady early. Ramp naturally.
- **Send yourself + a few friends** real signups in week 1 and **open/click/reply** — early engagement signals matter.

## Step 6 — Inbox-placement check (before SLC)
1. Send a test to **mail-tester.com** and aim for 9–10/10 (it flags SPF/DKIM/DMARC/content issues).
2. Test delivery to a **Gmail** and an **Outlook/Apple** address — confirm inbox, not spam/promotions.
3. Confirm the **one-click unsubscribe** header renders (Gmail shows an "Unsubscribe" link at the top).

---

## Deadlines
- **Now → early August:** domain added, DNS records in, verified green.
- **August:** warming as the free tool + build-in-public generate real signups (ties into Phase 3 build).
- **Before Sep 19 (SLC):** mail-tester ≥ 9/10, inbox placement confirmed, real mailing address in the footer.

## Decision reminder
This runbook assumes **Resend** (the recommendation in `Duravel_Phase3_Lifecycle_Email_Build_Plan.md`). If you choose **Loops.so** instead, the domain-auth concept is identical (subdomain + SPF/DKIM/DMARC) — Loops just guides you through it in their UI and hosts the sending. The warm-up and inbox-check steps still apply.
