# Duravel iOS — App Icon Guide

This covers everything needed to ship the Duravel app icon. Levi provides **one**
1024×1024 PNG brand mark; the included script produces the entire icon set.

## What Levi needs to provide

A single **`duravel-icon-1024.png`**:

- **1024 × 1024 px**, PNG, sRGB color profile.
- **No transparency / alpha channel** — the App Store rejects icons with alpha.
  Fill the whole square with a solid background (brand `#0B0B0F` works well, or a
  subtle dark gradient) and place the Duravel mark centered.
- **No rounded corners and no drop shadow** — iOS applies the rounded-rect mask
  itself. If you pre-round the corners you get a double-mask that looks wrong.
- Keep the mark within ~80% of the canvas (a little breathing room) so it isn't
  clipped by the corner mask on the home screen.

> If Levi only has an SVG/vector mark, export it at 1024px on the dark background
> first, then feed that PNG to the script.

## Generating the full set

From the repo root (or anywhere), run:

```bash
chmod +x Duravel_iOS_Part2_generate-app-icons.sh
./Duravel_iOS_Part2_generate-app-icons.sh duravel-icon-1024.png \
  ios/App/App/Assets.xcassets/AppIcon.appiconset
```

The script auto-detects `sips` (macOS, built-in) or ImageMagick (`magick`/`convert`)
and emits every file plus a matching `Contents.json`. It has been dry-run verified
to produce all 18 raster sizes at the correct pixel dimensions.

## The required sizes (reference)

| Purpose | pt | Scale | Pixels | Idiom |
|---|---|---|---|---|
| Notification | 20 | 2x / 3x | 40 / 60 | iPhone |
| Settings | 29 | 2x / 3x | 58 / 87 | iPhone |
| Spotlight | 40 | 2x / 3x | 80 / 120 | iPhone |
| App | 60 | 2x / 3x | 120 / 180 | iPhone |
| Notification | 20 | 1x / 2x | 20 / 40 | iPad |
| Settings | 29 | 1x / 2x | 29 / 58 | iPad |
| Spotlight | 40 | 1x / 2x | 40 / 80 | iPad |
| App | 76 | 1x / 2x | 76 / 152 | iPad |
| App | 83.5 | 2x | 167 | iPad Pro |
| Marketing | 1024 | 1x | 1024 | App Store |

## Simpler path (Xcode 14+)

Xcode now accepts a **single 1024 icon** and downscales the rest at build time.
If you prefer that, skip the script: in `Assets.xcassets → AppIcon`, set the
attributes inspector's *App Store* slot to **Single Size** and drop only
`duravel-icon-1024.png`. The script's full set is the safer, most compatible
option (works on every Xcode version and avoids occasional single-size validation
quirks), so it's the recommended default.

## Where this lands in the Capacitor project

After `npx cap add ios`, the iOS project lives at `ios/App`. The asset catalog is
`ios/App/App/Assets.xcassets/AppIcon.appiconset` — that's the default output path
the script targets. Commit the generated set so CI/other machines don't need to
regenerate.
