#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${AKMDL_DESKTOP_OUT:-/tmp/AKMDLibrary/desktop}"
APP_NAME="AKMDLibrary"
APP_DIR="$OUT_DIR/$APP_NAME.app"
INSTALL_DIR="${AKMDL_INSTALL_DIR:-}"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
HTML_DIR="$RESOURCES_DIR/html"
GOCACHE_DIR="${AKMDL_GOCACHE:-/tmp/AKMDLibrary/gocache}"

APP_VERSION="${AKMDL_VERSION:-$(git -C "$ROOT_DIR" describe --tags --always --dirty 2>/dev/null || echo dev)}"
BUNDLE_VERSION="${APP_VERSION#v}"
if [[ ! "$BUNDLE_VERSION" =~ ^[0-9]+(\.[0-9]+){1,2}$ ]]; then
  BUNDLE_VERSION="0.0.0"
fi
BUNDLE_BUILD="$(git -C "$ROOT_DIR" rev-list --count HEAD 2>/dev/null || echo 1)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$OUT_DIR" "$GOCACHE_DIR"
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$HTML_DIR"

echo "Building frontend..."
(
  cd "$ROOT_DIR/frontend"
  ./node_modules/.bin/tsc
  ./node_modules/.bin/vite build --outDir "$HTML_DIR" --emptyOutDir
)

echo "Building desktop binary..."
(
  cd "$ROOT_DIR/backend"
  CGO_ENABLED=1 \
  GOCACHE="$GOCACHE_DIR" \
  CGO_LDFLAGS="${CGO_LDFLAGS:-} -framework UniformTypeIdentifiers" \
  go build \
    -buildvcs=false \
    -tags "desktop,production,wv2runtime.download" \
    -ldflags "-s -w -X github.com/alwaysking/akmdlibrary/internal/app.Version=$APP_VERSION -X github.com/alwaysking/akmdlibrary/internal/app.BuildTime=$BUILD_TIME" \
    -o "$MACOS_DIR/akmdlibrary" \
    ./cmd/desktop
)

echo "Building app icon..."
SOURCE_ICON="$ROOT_DIR/frontend/public/icons/icon-512.png"
sips -s format icns "$SOURCE_ICON" --out "$RESOURCES_DIR/appicon.icns" >/dev/null

cat > "$CONTENTS_DIR/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>AKMDLibrary</string>
  <key>CFBundleExecutable</key>
  <string>akmdlibrary</string>
  <key>CFBundleIconFile</key>
  <string>appicon</string>
  <key>CFBundleIdentifier</key>
  <string>com.alwaysking.akmdlibrary</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>AKMDLibrary</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$BUNDLE_VERSION</string>
  <key>CFBundleVersion</key>
  <string>$BUNDLE_BUILD</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

SIGN_IDENTITY="${AKMDL_CODESIGN_IDENTITY:--}"
if [[ "$SIGN_IDENTITY" == "-" ]]; then
  codesign --force --deep --sign - "$APP_DIR" >/dev/null
else
  codesign --force --deep --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP_DIR" >/dev/null
fi
codesign --verify --deep --strict --verbose=2 "$APP_DIR" >/dev/null

if [[ -n "$INSTALL_DIR" ]]; then
  INSTALL_APP="$INSTALL_DIR/$APP_NAME.app"
  echo "Installing to $INSTALL_APP..."
  rm -rf "$INSTALL_APP"
  ditto "$APP_DIR" "$INSTALL_APP"
  codesign --verify --deep --strict --verbose=2 "$INSTALL_APP" >/dev/null
  echo "Installed: $INSTALL_APP"
fi

echo "Built: $APP_DIR"
