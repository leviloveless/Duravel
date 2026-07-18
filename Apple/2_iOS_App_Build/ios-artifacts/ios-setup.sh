#!/usr/bin/env bash
# Duravel iOS — Capacitor bootstrap. Run ON THE MAC, from the repo root, after
# copying capacitor.config.ts into place. Read before running.
set -euo pipefail

# 1. Install Capacitor + the v1 plugin set (matches Part 1 §4).
npm install \
  @capacitor/core@^6.1.0 \
  @capacitor/ios@^6.1.0 \
  @capacitor/app@^6.0.0 \
  @capacitor/haptics@^6.0.0 \
  @capacitor/keyboard@^6.0.0 \
  @capacitor/preferences@^6.0.0 \
  @capacitor/browser@^6.0.0 \
  @capacitor/splash-screen@^6.0.0 \
  @capacitor/status-bar@^6.0.0 \
  @capacitor/push-notifications@^6.0.0
npm install -D @capacitor/cli@^6.1.0

# 2. Initialize Capacitor only if it isn't already (config is already provided).
if [ ! -f capacitor.config.ts ] && [ ! -f capacitor.config.json ]; then
  npx cap init "Duravel" "app.duravel" --web-dir=public
fi

# 3. Add the iOS platform (creates ios/). Safe to skip if ios/ exists.
if [ ! -d ios ]; then
  npx cap add ios
fi

# 4. Sync web assets + plugins into the native project.
npx cap sync ios

# 5. Open in Xcode to configure signing, capabilities, and run on a device.
#    (Capabilities to add: HealthKit, Push, Sign in with Apple, In-App Purchase,
#     Associated Domains — see Part 1 §7.)
npx cap open ios

echo "Done. In Xcode: set the team/signing, add the five capabilities, then Run."
