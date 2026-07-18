# Duravel iOS — Part 2: Native Shell & UX Polish

Drop-in artifacts that make the Capacitor 6 shell (which loads
`https://app.duravel.app` via `server.url`) feel like a real native iOS app:
app icon, splash, safe areas, status bar, dark-flash prevention, offline screen,
haptics, keyboard/overscroll/swipe-back, and a single web↔native bridge.

Everything here is **additive to Part 1** (which created the Capacitor project and
base `capacitor.config`). Nothing requires a SwiftUI rewrite.

Conventions used throughout: app **Duravel**, bundle **app.duravel**, min iOS
**15.0**, Capacitor **6**, scheme **duravel://**, brand background **#0B0B0F**.

---

## Files in this part

| File | What it is | Lands in |
|---|---|---|
| `Duravel_iOS_Part2_generate-app-icons.sh` | Emits the full AppIcon set from one 1024px PNG | run at build/dev time |
| `Duravel_iOS_Part2_AppIcon_Guide.md` | Icon source rules + how to run the script | docs |
| `Duravel_iOS_Part2_LaunchScreen.storyboard` | Native dark launch screen | `ios/App/App/Base.lproj/` |
| `Duravel_iOS_Part2_splash.ts` | Hide splash after first paint | web app (`lib/native/`) |
| `Duravel_iOS_Part2_status-bar.ts` | Light status-bar content for dark theme | web app |
| `Duravel_iOS_Part2_safe-area.css` | `env(safe-area-inset-*)` handling | web app global CSS |
| `Duravel_iOS_Part2_dark-mode.css` | White-flash prevention at DOM layer | web app global CSS |
| `Duravel_iOS_Part2_offline.html` | Self-contained offline/error screen | app bundle + test |
| `Duravel_iOS_Part2_network.ts` | Connectivity controller + runtime overlay | web app |
| `Duravel_iOS_Part2_haptics.ts` | Semantic haptics wrapper | web app |
| `Duravel_iOS_Part2_webview-behavior.ts` | Keyboard, overscroll, swipe-back, platform tag | web app |
| `Duravel_iOS_Part2_native-bridge.ts` | **The single import surface** | web app |

The `.ts` and `.css` files are meant to live **in the web app repo** (`hyroxai/`,
suggested folder `lib/native/` for TS and your global stylesheet for CSS), because
the shell renders the hosted web app — native-feel code has to run inside that web
context. The storyboard, icon set, and `offline.html` live in the **native iOS
project** (`ios/App`).

---

## Quick integration (web app side)

1. Copy the six `.ts` files into `hyroxai/lib/native/`.
2. Add the two CSS files to your global stylesheet (import them, or paste their
   contents). If you can't touch global CSS yet, the bridge injects a critical
   subset at runtime (see `injectCSS`).
3. Add to your root `<head>` (required for safe areas + dark theme color):

   ```html
   <meta name="viewport"
     content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no">
   <meta name="theme-color" content="#0B0B0F">
   ```

4. Initialize once, as early as possible (e.g. root layout / `_app`):

   ```ts
   import { Duravel } from '@/lib/native/Duravel_iOS_Part2_native-bridge';

   useEffect(() => {
     Duravel.init({
       onReconnect: () => queryClient.invalidateQueries(),
       onRootBack: () => closeTopSheet(),  // return true if you handled it
       onDeepLink: (url) => router.push(pathFromDeepLink(url)),
       onResume: () => refreshSession(),
     }).then(() => Duravel.ready()); // ready() hides the splash after first paint
   }, []);
   ```

5. Use native features anywhere through the bridge:

   ```ts
   Duravel.haptics.success();          // set logged
   Duravel.haptics.selection();        // tab change
   if (Duravel.isNative) { /* show install-free UI */ }
   ```

All of it is **no-op safe on the web**, so the same bundle serves the browser and
the iOS shell.

---

## Native project side (Xcode / capacitor.config)

### App icon
Run the generator with Levi's 1024px source (see `Duravel_iOS_Part2_AppIcon_Guide.md`):
```bash
./Duravel_iOS_Part2_generate-app-icons.sh duravel-icon-1024.png \
  ios/App/App/Assets.xcassets/AppIcon.appiconset
```

### Launch screen
Replace `ios/App/App/Base.lproj/LaunchScreen.storyboard` with the provided file and
add a `Splash` image to the asset catalog (or delete the imageView for a plain dark
screen). Verified as well-formed XML.

### capacitor.config additions (merge with Part 1)
```ts
const config: CapacitorConfig = {
  appId: 'app.duravel',
  appName: 'Duravel',
  server: { url: 'https://app.duravel.app', cleartext: false },
  backgroundColor: '#0B0B0F',            // webview bg — kills the white webview flash
  ios: {
    backgroundColor: '#0B0B0F',
    scrollEnabled: false,                // page-level rubber-band off (inner scrollers still scroll)
    contentInset: 'never',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,             // JS hides it (Duravel.ready())
      backgroundColor: '#0B0B0F',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
    StatusBar: { style: 'DARK', overlaysWebView: false }, // DARK = light glyphs
  },
};
```

### Info.plist keys
```xml
<key>UIStatusBarStyle</key>                              <string>UIStatusBarStyleLightContent</string>
<key>UIViewControllerBasedStatusBarAppearance</key>      <false/>
<key>UIUserInterfaceStyle</key>                          <string>Dark</string>   <!-- app is always dark -->
```
(`UIUserInterfaceStyle = Dark` stops iOS from ever handing the webview a light
system appearance, the last white-flash vector.)

### Swipe-back gesture (AppDelegate / Capacitor bridge)
Enable WKWebView's edge-swipe so in-app navigation gets the native back gesture.
In `ios/App/App/AppDelegate.swift` (or a small `CAPBridgeViewController` subclass),
after the bridge webview exists:
```swift
webView?.allowsBackForwardNavigationGestures = true
```
The JS side (`setupSwipeBack` in `webview-behavior.ts`, wired via
`Duravel.init({ onRootBack })`) traps the back at the SPA root / when a sheet is
open so the gesture never accidentally exits the app.

### Offline fallback (optional but recommended)
Bundle `Duravel_iOS_Part2_offline.html` into the app and navigate to it if the
remote shell fails to load on cold start (network down at launch). At runtime,
`NetworkController` (started by `Duravel.init`) already shows an in-app overlay
when connectivity drops after load, so this bundled file only covers the
"never loaded" case.

---

## White-flash defense (defense in depth)

Every layer is painted `#0B0B0F` so there is no seam anywhere:
LaunchScreen storyboard → `capacitor.config` `backgroundColor` (webview) →
`UIUserInterfaceStyle Dark` → `dark-mode.css` (`html/body/#root`) →
splash held until first real paint (`Duravel.ready()`).

---

## Plugins to install

```bash
npm i @capacitor/core @capacitor/app @capacitor/haptics \
      @capacitor/status-bar @capacitor/splash-screen \
      @capacitor/keyboard @capacitor/network
npx cap sync ios
```

## Verification done in this part
- Icon script dry-run: produced all 18 sizes at correct pixel dimensions + valid `Contents.json`.
- All 6 TypeScript modules transpile cleanly (esbuild).
- `LaunchScreen.storyboard` parses as well-formed XML.
- `offline.html` markup balanced; retry + auto-recover wired.

What still needs a device/Xcode: on-device haptics feel, actual notch insets on
real hardware, swipe-back behavior, and App Store icon validation — none possible
from the cloud sandbox.
