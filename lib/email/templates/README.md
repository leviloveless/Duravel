# Duravel email templates (`lib/email/templates/`)

React Email components for the 07-spec trial-conversion set. Pure-presentational, typed props, inline styles matching the live auth/nurture design system (paper `#eceae6`, ink `#0E1116`, orange dot `#FF5A1F`, 600px column, Arial stack). **Typechecks clean under the repo's strict tsconfig** (`noUncheckedIndexedAccess`, `noUnusedParameters`, etc.) and renders to HTML + plain text via `@react-email/render`.

## Files
| File | Export | Category | Trigger |
|---|---|---|---|
| `_Layout.tsx` | `Layout` | — | Shared shell: wordmark header + CAN-SPAM footer |
| `Welcome.tsx` | `Welcome` | onboarding / service | First authed session, confirmed email |
| `OnboardingNudge.tsx` | `OnboardingNudge` | onboarding / **lifecycle** | Signed up 2–3d ago, no program |
| `TrialEnding.tsx` | `TrialEnding` (prop `stage: 'T-3'\|'T-1'\|'T-0'`) | billing / service | `trial_started_at + {11,13,14}d`, no active sub |
| `Receipt.tsx` | `Receipt` | billing / service | Stripe `checkout.session.completed` / `invoice.paid` |
| `types.ts` | prop interfaces | — | — |
| `styles.ts` | tokens + style objects | — | — |
| `index.ts` | barrel | — | — |

Only `OnboardingNudge` is lifecycle-suppressible, so it's the only one whose footer carries a real `unsubscribeUrl` + should ship RFC 8058 one-click headers. Welcome / TrialEnding / Receipt are **service** — footer says "Manage email preferences," no hard unsubscribe.

## Install (Phase A — pin versions, then `next build` to prove React 19 peers resolve)
```
npm install resend @react-email/components @react-email/render
```
Verified here against `@react-email/components` 0.5.x / `@react-email/render` (react-email 6.9.0) on React 19.2.4. Confirm peer ranges at install time (07-spec §4.5), then run `npm run build`.

## Subjects (set in `send.ts`, not the component — preheaders live in each component's `<Preview>`)
- Welcome — **You're in — let's build your plan**
- Onboarding nudge — **Your plan is one step away**
- Trial-ending T-3 — **3 days left on your Duravel trial**
- Trial-ending T-1 — **Your Duravel trial ends tomorrow**
- Trial-ending T-0 — **Your trial ends today — keep your plan**
- Receipt — **You're all set — welcome to Duravel**

## How the choke-point consumes these (07-spec §4.1)
```ts
import { render } from '@react-email/render';
import { TrialEnding } from '@/lib/email/templates';

const el = <TrialEnding stage="T-3" firstName={p.firstName} sessionsLogged={p.sessions}
             weeksCompleted={p.weeks} programName={p.program}
             subscribeUrl={urls.monthly} annualUrl={urls.annual} manageUrl={urls.manage} />;
const html = await render(el);
const text = await render(el, { plainText: true }); // deliverability
// → resend.emails.send({ from: EMAIL_FROM, to, subject, html, text,
//     headers: { 'Idempotency-Key': dedupKey, 'List-Unsubscribe': ... } })
```

## Two things the flow (not the template) must enforce
1. **Late entitlement re-check** immediately before any trial-ending send (§4.1 step 7) — re-read `subscriptions`; if now active, skip. The template can't know this.
2. **Graceful `sessionsLogged` degradation** is handled *inside* `TrialEnding` — pass `0`/omit and it drops the stat block and swaps copy. But prefer to pass the real count; only T-3 shows the full stat card.

## Notes
- Dates and money are pre-formatted upstream (`trialEndDate`, `amount`, `renewalDate`) so templates stay pure.
- `MAILING_ADDRESS` in `styles.ts` = `5900 Balcones Dr STE 100, Austin, TX 78731` (matches live /pace + /deka footers). Change in one place if the address updates.
- Replaces the `_phase3_draft/lib/email/templates.ts` string scaffold (excluded from tsconfig; delete when this lands).
