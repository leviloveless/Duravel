# Deploying the apple-app-site-association (AASA) file

The AASA file tells iOS which app owns `https://duravel.app` links so they
open in the Duravel app instead of Safari (Universal Links).

> ## ✅ SHIPPED 2026-08-17 — this is now code, not a manual step
>
> The file is served live by the Next.js app from
> **`app/.well-known/apple-app-site-association/route.ts`**, built by
> **`lib/apple/aasa.ts`** and pinned by `lib/apple/aasa.test.ts`.
>
> **The only thing left for you is one environment variable.** Set
> `APPLE_TEAM_ID` in Vercel (Project → Settings → Environment Variables) to your
> 10-character Team ID from developer.apple.com → Membership, then redeploy.
>
> **The route returns 404 until that is set, on purpose.** Apple's CDN caches
> whatever it fetches, so publishing a file containing the literal string
> `TEAMID` would get an *invalid* association cached against the domain — and
> Universal Links would keep failing after you fixed it, for reasons invisible
> from inside the app. A 404 caches nothing.
>
> The standalone `Duravel_iOS_Part3_apple-app-site-association.json` in
> `../web/` and the hand-written route in section 2 below are both **superseded**
> — kept for reference only. Do not deploy them; the live version differs on
> purpose (it excludes the marketing pages, and it drops `/reset-password*`,
> `/confirm*`, `/workout/*` and `/invite/*`, none of which are real routes in
> this app).

## 1. Replace the placeholder Team ID *(superseded — see the box above)*

In `Duravel_iOS_Part3_apple-app-site-association.json`, replace **`TEAMID`**
(both occurrences: `applinks` and `webcredentials`) with your 10-character
Apple Team ID (developer.apple.com → Membership → Team ID). Final value looks
like `A1B2C3D4E5.app.duravel`.

## 2. Host it at the exact path

The file MUST be served at **both** of these (Apple checks the first; the
`.well-known` path is the modern one and what you should use):

```
https://duravel.app/.well-known/apple-app-site-association
```

Rules that trip people up:

- **No `.json` extension** on the served path (the file on disk here is named
  `.json` only so editors format it — serve it WITHOUT the extension).
- Serve it with `Content-Type: application/json`.
- Serve it over **HTTPS with a valid cert**, no redirects.
- **No authentication / no query string / status 200.**

### Next.js (App Router) — recommended: a route handler

Because `duravel.app` is the Next.js app, add a route that returns the JSON
with the right content type. Create
`hyroxai/app/.well-known/apple-app-site-association/route.ts`:

```ts
import { NextResponse } from 'next/server';

const AASA = {
  applinks: {
    details: [
      {
        appIDs: ['TEAMID.app.duravel'],
        components: [
          { '/': '/auth/*' },
          { '/': '/reset-password*' },
          { '/': '/confirm*' },
          { '/': '/workout/*' },
          { '/': '/program/*' },
          { '/': '/invite/*' },
          { '/': '*' },
        ],
      },
    ],
  },
  webcredentials: { apps: ['TEAMID.app.duravel'] },
};

export function GET() {
  return NextResponse.json(AASA, {
    headers: { 'content-type': 'application/json' },
  });
}
```

(Route handlers under `app/.well-known/...` are served without the `.json`
extension automatically. Keep this JSON in sync with the standalone file.)

Alternatively drop the file in `public/.well-known/apple-app-site-association`
and add a `headers()` rule in `next.config.js` forcing the content type — but
the route handler is cleaner and avoids extension issues on Vercel.

## 3. Verify after deploy

Against the LIVE route (this is the one that matters):

```bash
curl -i https://duravel.app/.well-known/apple-app-site-association
# Expect: HTTP/2 200, content-type: application/json, the JSON body, no redirect
```

Apple's CDN caches AASA for the app on install/update. On device, delete +
reinstall the app after changing the file. Use Apple's validator:
`https://app-site-association.cdn-apple.com/a/v1/duravel.app`.

## 4. Association is two-sided

The domain side (this file) must match the app side
(`Duravel_iOS_Part3_Duravel.entitlements`, key
`com.apple.developer.associated-domains` → `applinks:duravel.app`). Both
must be live for Universal Links to route into the app.
