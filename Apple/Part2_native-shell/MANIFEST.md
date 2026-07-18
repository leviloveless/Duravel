# Duravel iOS — Part 2 (Native Shell & UX Polish) — MANIFEST

Bundle root: `Apple/Part2_native-shell/`
Unzip into `C:\dev\duravel` → lands as `C:\dev\duravel\Apple\Part2_native-shell\`.

These are drop-in artifacts. Copy each file to its **Destination in repo** below.
Nothing here was written to your machine — the zip in chat is the delivery.

| Bundle path | Destination in repo | Type | Note |
|---|---|---|---|
| `docs/Duravel_iOS_Part2_README.md` | `Apple/Part2_native-shell/` (reference) | doc | **Start here.** Full integration steps: web side, native side, capacitor.config / Info.plist / AppDelegate merges, white-flash defense, plugin install list. |
| `docs/Duravel_iOS_Part2_AppIcon_Guide.md` | reference | doc | Icon source rules (1024px, no alpha, no rounded corners), size table, how to run the generator. |
| `ios/Duravel_iOS_Part2_LaunchScreen.storyboard` | `hyroxai/ios/App/App/Base.lproj/LaunchScreen.storyboard` | code | Native dark launch screen (#0B0B0F, centered `Splash` image). Replaces the default. Well-formed XML. |
| `ios/Duravel_iOS_Part2_offline.html` | `hyroxai/ios/App/App/public/offline.html` (bundle it) | code | Self-contained cold-start offline/error fallback. Wire as the load-error fallback in AppDelegate; also opens standalone in a browser. |
| `scripts/Duravel_iOS_Part2_generate-app-icons.sh` | `hyroxai/scripts/generate-app-icons.sh` | script | Emits full `AppIcon.appiconset` (18 sizes + Contents.json) from one 1024px PNG. Outputs to `ios/App/App/Assets.xcassets/AppIcon.appiconset` by default. |
| `web/Duravel_iOS_Part2_native-bridge.ts` | `hyroxai/lib/native/native-bridge.ts` | code | **Single import surface.** `Duravel.init()`, `.ready()`, `.haptics`, deep links, offline, resume. Composes the modules below. |
| `web/Duravel_iOS_Part2_haptics.ts` | `hyroxai/lib/native/haptics.ts` | code | Semantic haptics over @capacitor/haptics. No-op safe on web. |
| `web/Duravel_iOS_Part2_status-bar.ts` | `hyroxai/lib/native/status-bar.ts` | code | Light status-bar glyphs for the dark theme; hide/show for full-screen timers. |
| `web/Duravel_iOS_Part2_splash.ts` | `hyroxai/lib/native/splash.ts` | code | Hide splash after first real paint (2×rAF) with 4s safety cap. |
| `web/Duravel_iOS_Part2_network.ts` | `hyroxai/lib/native/network.ts` | code | Connectivity + foreground controller; shows the offline overlay, fires `onReconnect`. |
| `web/Duravel_iOS_Part2_webview-behavior.ts` | `hyroxai/lib/native/webview-behavior.ts` | code | Platform tag (`html.duravel-native`), overscroll lock, keyboard handling, iOS swipe-back. |
| `web/Duravel_iOS_Part2_safe-area.css` | `hyroxai/` global stylesheet (import or paste) | code | `env(safe-area-inset-*)` handling + utility classes, gated on `html.duravel-native`. |
| `web/Duravel_iOS_Part2_dark-mode.css` | `hyroxai/` global stylesheet (import or paste) | code | White-flash prevention at the DOM layer (root, `#root`/`#__next`, overscroll gutters). |

## Also required (instructions live in the README, not as standalone files)
- **`hyroxai/capacitor.config.ts`** — merge the Part 2 additions (`backgroundColor`, `ios.scrollEnabled`, SplashScreen, Keyboard, StatusBar) into the Part 1 config.
- **`hyroxai/ios/App/App/Info.plist`** — add `UIStatusBarStyle`, `UIViewControllerBasedStatusBarAppearance`, `UIUserInterfaceStyle`.
- **`hyroxai/ios/App/App/AppDelegate.swift`** — set `webView?.allowsBackForwardNavigationGestures = true`.
- **Web `<head>`** — add the `viewport-fit=cover` meta + `theme-color`.
- **Install plugins:** `@capacitor/core @capacitor/app @capacitor/haptics @capacitor/status-bar @capacitor/splash-screen @capacitor/keyboard @capacitor/network`, then `npx cap sync ios`.

> Note: repo paths assume the Next.js app lives under `hyroxai/` and the iOS project
> under `hyroxai/ios/App` (default `npx cap add ios` layout). Adjust the `hyroxai/`
> prefix if the Capacitor project was initialized at the repo root instead.

## Verification performed this run
- Icon script dry-run → all 18 sizes at correct pixel dimensions + valid Contents.json.
- All 6 TypeScript modules transpile cleanly (esbuild).
- LaunchScreen.storyboard parses as well-formed XML.
- offline.html markup balanced; retry + auto-recover wired.
