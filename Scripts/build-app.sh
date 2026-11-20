#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
project="$PWD"
dist="${ANY2WEBP_DIST:-$project/dist}"
config="$project/src-tauri/tauri.conf.json"
name="$(plutil -extract productName raw -o - "$config")"
version="$(plutil -extract version raw -o - "$config")"
identifier="$(plutil -extract identifier raw -o - "$config")"
min_version="$(plutil -extract bundle.macOS.minimumSystemVersion raw -o - "$config")"
app="$dist/$name.app"
if [[ -e "$app" ]]; then
  printf '已有本地应用包，请先归档或指定 ANY2WEBP_DIST：%s\n' "$app" >&2
  exit 1
fi

export MACOSX_DEPLOYMENT_TARGET="$min_version"
export CARGO_TARGET_DIR="$project/src-tauri/target"
mkdir -p "$CARGO_TARGET_DIR"
lock="$CARGO_TARGET_DIR/.any2webp-build.lock"
if ! mkdir "$lock" 2>/dev/null; then
  printf '已有应用构建持有锁：%s\n' "$lock" >&2
  exit 1
fi
stage=""
cleanup() {
  if [[ -n "$stage" ]]; then rm -rf "$stage"; fi
  rm -f "$lock/pid"
  rmdir "$lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' "$$" > "$lock/pid"

./Scripts/build-codec.sh
cargo build --manifest-path src-tauri/Cargo.toml --release --locked --features tauri/custom-protocol

mkdir -p "$dist"
stage="$(mktemp -d "$dist/.any2webp-build.XXXXXXXX")"
staged_app="$stage/$name.app"
bundle="$staged_app/Contents"
mkdir -p "$bundle/MacOS" "$bundle/Resources"
install -m 755 src-tauri/target/release/any2webp "$bundle/MacOS/any2webp"
case "$(uname -m)" in
  arm64) triple=aarch64-apple-darwin ;;
  x86_64) triple=x86_64-apple-darwin ;;
esac
install -m 755 "src-tauri/binaries/any2webp-codec-$triple" "$bundle/MacOS/any2webp-codec"
cp src-tauri/icons/icon.icns "$bundle/Resources/AppIcon.icns"
cp LICENSE docs/THIRD-PARTY-NOTICES.txt docs/licenses/libwebp-PATENTS.txt "$bundle/Resources/"
python3 Scripts/collect-rust-notices.py "$triple" "$bundle/Resources/RUST-NOTICES.txt"
cat > "$bundle/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleLocalizations</key><array><string>en</string><string>zh-Hans</string><string>ja</string></array>
  <key>CFBundleDisplayName</key><string>$name</string>
  <key>CFBundleExecutable</key><string>any2webp</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>$identifier</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>$min_version</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
plutil -lint "$bundle/Info.plist"
codesign --force --sign - "$bundle/MacOS/any2webp-codec"
codesign --force --sign - "$staged_app"
codesign --verify --deep --strict "$staged_app"
mv -n "$staged_app" "$app"
if [[ -e "$staged_app" ]]; then
  printf '另一个进程已创建应用包：%s\n' "$app" >&2
  exit 1
fi
printf '应用包：%s\n' "$app"
