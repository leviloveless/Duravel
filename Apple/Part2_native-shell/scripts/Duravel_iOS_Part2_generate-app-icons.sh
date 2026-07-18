#!/usr/bin/env bash
#
# Duravel iOS — App Icon generator
# ---------------------------------
# Emits a complete AppIcon.appiconset (every size Xcode/App Store needs)
# from a single 1024x1024 PNG source.
#
# USAGE
#   ./Duravel_iOS_Part2_generate-app-icons.sh <source-1024.png> [output-dir]
#
# Default output-dir:
#   ios/App/App/Assets.xcassets/AppIcon.appiconset
#
# REQUIREMENTS (either works; script auto-detects)
#   • macOS:  sips           (preinstalled — nothing to install)
#   • any OS: ImageMagick     (brew install imagemagick  /  apt-get install imagemagick)
#
# SOURCE IMAGE RULES (Apple)
#   • Exactly 1024x1024 px, PNG, sRGB, NO alpha/transparency (App Store rejects alpha).
#   • NO rounded corners — iOS masks the corners itself.
#   • Fill the full square; the Duravel mark should sit on the brand
#     background #0B0B0F (or its own solid bg). Provided by Levi.
#
set -euo pipefail

SRC="${1:-}"
OUT="${2:-ios/App/App/Assets.xcassets/AppIcon.appiconset}"

if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "ERROR: source PNG not found."
  echo "Usage: $0 <source-1024.png> [output-dir]"
  exit 1
fi

mkdir -p "$OUT"

# --- pick a resizer -------------------------------------------------------
RESIZER=""
if command -v sips >/dev/null 2>&1; then
  RESIZER="sips"
elif command -v magick >/dev/null 2>&1; then
  RESIZER="magick"
elif command -v convert >/dev/null 2>&1; then
  RESIZER="convert"
else
  echo "ERROR: need 'sips' (macOS) or ImageMagick ('magick'/'convert')."
  exit 1
fi
echo "Using resizer: $RESIZER"

resize() {  # resize <px> <destfile>
  local px="$1" dest="$2"
  case "$RESIZER" in
    sips)    sips -s format png -z "$px" "$px" "$SRC" --out "$dest" >/dev/null ;;
    magick)  magick "$SRC" -resize "${px}x${px}" -strip -background '#0B0B0F' -alpha remove -alpha off "$dest" ;;
    convert) convert "$SRC" -resize "${px}x${px}" -strip -background '#0B0B0F' -alpha remove -alpha off "$dest" ;;
  esac
}

# --- the full iOS icon matrix --------------------------------------------
# Format: "pixelsize:filename"
# (idiom/scale metadata lives in Contents.json, generated below.)
SIZES=(
  "40:icon-20@2x.png"      # iPhone Notification 20pt @2x
  "60:icon-20@3x.png"      # iPhone Notification 20pt @3x
  "58:icon-29@2x.png"      # iPhone Settings 29pt @2x
  "87:icon-29@3x.png"      # iPhone Settings 29pt @3x
  "80:icon-40@2x.png"      # iPhone Spotlight 40pt @2x
  "120:icon-40@3x.png"     # iPhone Spotlight 40pt @3x
  "120:icon-60@2x.png"     # iPhone App 60pt @2x
  "180:icon-60@3x.png"     # iPhone App 60pt @3x
  "20:icon-20.png"         # iPad Notification 20pt @1x
  "40:icon-20@2x-ipad.png" # iPad Notification 20pt @2x
  "29:icon-29.png"         # iPad Settings 29pt @1x
  "58:icon-29@2x-ipad.png" # iPad Settings 29pt @2x
  "40:icon-40.png"         # iPad Spotlight 40pt @1x
  "80:icon-40@2x-ipad.png" # iPad Spotlight 40pt @2x
  "76:icon-76.png"         # iPad App 76pt @1x
  "152:icon-76@2x.png"     # iPad App 76pt @2x
  "167:icon-83.5@2x.png"   # iPad Pro App 83.5pt @2x
  "1024:icon-1024.png"     # App Store Marketing 1024pt @1x
)

echo "Generating $((${#SIZES[@]})) icon files into: $OUT"
for entry in "${SIZES[@]}"; do
  px="${entry%%:*}"
  name="${entry##*:}"
  resize "$px" "$OUT/$name"
  printf "  ✓ %-22s %sx%s\n" "$name" "$px" "$px"
done

# --- write Contents.json --------------------------------------------------
cat > "$OUT/Contents.json" <<'JSON'
{
  "images" : [
    { "idiom" : "iphone", "size" : "20x20", "scale" : "2x", "filename" : "icon-20@2x.png" },
    { "idiom" : "iphone", "size" : "20x20", "scale" : "3x", "filename" : "icon-20@3x.png" },
    { "idiom" : "iphone", "size" : "29x29", "scale" : "2x", "filename" : "icon-29@2x.png" },
    { "idiom" : "iphone", "size" : "29x29", "scale" : "3x", "filename" : "icon-29@3x.png" },
    { "idiom" : "iphone", "size" : "40x40", "scale" : "2x", "filename" : "icon-40@2x.png" },
    { "idiom" : "iphone", "size" : "40x40", "scale" : "3x", "filename" : "icon-40@3x.png" },
    { "idiom" : "iphone", "size" : "60x60", "scale" : "2x", "filename" : "icon-60@2x.png" },
    { "idiom" : "iphone", "size" : "60x60", "scale" : "3x", "filename" : "icon-60@3x.png" },
    { "idiom" : "ipad",   "size" : "20x20", "scale" : "1x", "filename" : "icon-20.png" },
    { "idiom" : "ipad",   "size" : "20x20", "scale" : "2x", "filename" : "icon-20@2x-ipad.png" },
    { "idiom" : "ipad",   "size" : "29x29", "scale" : "1x", "filename" : "icon-29.png" },
    { "idiom" : "ipad",   "size" : "29x29", "scale" : "2x", "filename" : "icon-29@2x-ipad.png" },
    { "idiom" : "ipad",   "size" : "40x40", "scale" : "1x", "filename" : "icon-40.png" },
    { "idiom" : "ipad",   "size" : "40x40", "scale" : "2x", "filename" : "icon-40@2x-ipad.png" },
    { "idiom" : "ipad",   "size" : "76x76", "scale" : "1x", "filename" : "icon-76.png" },
    { "idiom" : "ipad",   "size" : "76x76", "scale" : "2x", "filename" : "icon-76@2x.png" },
    { "idiom" : "ipad",   "size" : "83.5x83.5", "scale" : "2x", "filename" : "icon-83.5@2x.png" },
    { "idiom" : "ios-marketing", "size" : "1024x1024", "scale" : "1x", "filename" : "icon-1024.png" }
  ],
  "info" : { "version" : 1, "author" : "xcode" }
}
JSON

echo ""
echo "Done. AppIcon.appiconset written to: $OUT"
echo "Open the project in Xcode → Assets.xcassets → AppIcon should be fully populated."
echo ""
echo "SINGLE-SIZE ALTERNATIVE (Xcode 14+): you may instead drop just icon-1024.png"
echo "into a 'Single Size' AppIcon slot and let Xcode downscale at build time."
