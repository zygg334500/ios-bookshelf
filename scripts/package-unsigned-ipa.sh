#!/usr/bin/env bash
# Build an unsigned iOS IPA on a Mac (or a GitHub-hosted macOS runner).
# Sideloadly on Windows re-signs it with a free Apple ID. No paid developer account.
set -euo pipefail

export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export EXPO_NO_TELEMETRY=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/app"

echo "Xcode: $(xcodebuild -version | paste -sd ' ' -)"
npx expo prebuild --platform ios --clean

cd ios
# Top-level app workspace only. Pods.xcworkspace and *.xcodeproj/project.xcworkspace
# are not the scheme Expo generates, and `find | head` can trip pipefail.
WORKSPACE=""
for candidate in ./*.xcworkspace; do
  if [[ -d "$candidate" ]]; then
    WORKSPACE="$candidate"
    break
  fi
done
if [[ -z "$WORKSPACE" ]]; then
  echo "找不到 Xcode workspace。prebuild 没有生成 ios 工程。" >&2
  exit 1
fi
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"
echo "Using workspace ${WORKSPACE} scheme ${SCHEME}"

ARCHIVE="$ROOT/dist/BookShelf.xcarchive"
rm -rf "$ARCHIVE"
mkdir -p "$ROOT/dist"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -skipPackagePluginValidation \
  -skipMacroValidation \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  DEVELOPMENT_TEAM="" \
  COMPILER_INDEX_STORE_ENABLE=NO \
  archive

APP=""
for candidate in "$ARCHIVE/Products/Applications/"*.app; do
  if [[ -d "$candidate" ]]; then
    APP="$candidate"
    break
  fi
done
if [[ -z "$APP" ]]; then
  echo "归档里没有 .app。" >&2
  exit 1
fi
STAGE="$ROOT/dist/ipa-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/Payload"
cp -R "$APP" "$STAGE/Payload/"
rm -f "$ROOT/dist/BookShelf-unsigned.ipa"
(
  cd "$STAGE"
  zip -qry "$ROOT/dist/BookShelf-unsigned.ipa" Payload
)
echo "Wrote $ROOT/dist/BookShelf-unsigned.ipa"
