#!/bin/bash
set -euo pipefail

caller="$PWD"
cd "$(dirname "$0")/.."
project="$PWD"
fail() { printf '%s\n' "$*" >&2; exit 1; }

mode="${1:-}"
usage="用法：Scripts/prepare-release.sh --preview | --release-ad-hoc | --stable"
(( $# == 1 )) || fail "$usage"
case "$mode" in
  --preview|--release-ad-hoc|--stable) ;;
  *) fail "$usage" ;;
esac
[[ "$(uname -m)" == "arm64" ]] || fail "此发布流程需要 Apple Silicon Mac。"

config=src-tauri/tauri.conf.json
name="$(plutil -extract productName raw -o - "$config")"
version="$(plutil -extract version raw -o - "$config")"
identifier="$(plutil -extract identifier raw -o - "$config")"
min_version="$(plutil -extract bundle.macOS.minimumSystemVersion raw -o - "$config")"
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail "版本必须为 X.Y.Z。"
repo="ixiehao/Any2WebP"
tag="v$version"
revision=""
source_tree=""
suffix="-preview"
signing="ad-hoc"
notarization="not-notarized"
if [[ "$mode" != "--preview" ]]; then
  [[ "$(git rev-parse --show-toplevel 2>/dev/null)" == "$project" ]] ||
    fail "公开版必须从 Any2WebP 自身的 Git 仓库构建。"
  origin="$(git remote get-url origin)"
  case "$origin" in
    "https://github.com/$repo"|"https://github.com/$repo.git"|"git@github.com:$repo.git") ;;
    *) fail "origin 必须指向 github.com/$repo。" ;;
  esac
  changes="$(git status --porcelain)"
  [[ -z "$changes" ]] || fail "公开版构建前请提交所有源码改动。"
  revision="$(git rev-parse HEAD)"
  source_tree="$(git rev-parse 'HEAD^{tree}')"
  suffix=""
fi
if [[ "$mode" == "--stable" ]]; then
  identity="${ANY2WEBP_SIGN_IDENTITY:-}"
  profile="${ANY2WEBP_NOTARY_PROFILE:-}"
  [[ "$identity" == "Developer ID Application: "* && -n "$profile" ]] ||
    fail "公证版需要 Developer ID Application 签名和已存储的公证配置。"
  signing="Developer ID Application"
  notarization="Apple-notarized"
fi

releases="${ANY2WEBP_RELEASES_DIR:-$project/dist/releases}"
[[ "$releases" == /* ]] || releases="$caller/$releases"
mkdir -p "$releases"
releases="$(cd "$releases" && pwd -P)"
output="$releases/$tag-arm64$suffix"
[[ ! -e "$output" && ! -L "$output" ]] || fail "发布产物已存在：$output"

matches_dmg_tools() {
  PYTHONDONTWRITEBYTECODE=1 "$1" -c '
from importlib.metadata import version
import sys

import dmgbuild, ds_store, mac_alias

with open(sys.argv[1]) as requirements:
    packages = (line.strip().split("==") for line in requirements)
    sys.exit(not all(version(package) == pinned for package, pinned in packages))
' Scripts/dmg-requirements.txt >/dev/null 2>&1
}

dmg_python="${ANY2WEBP_DMG_PYTHON:-}"
if [[ -n "$dmg_python" ]]; then
  matches_dmg_tools "$dmg_python" || fail "指定的 ANY2WEBP_DMG_PYTHON 未安装 Scripts/dmg-requirements.txt 中的版本。"
else
  for candidate in "$project/dist/.dmg-tools/bin/python3" /opt/homebrew/bin/python3 /usr/local/bin/python3 python3; do
    if matches_dmg_tools "$candidate"; then
      dmg_python="$candidate"
      break
    fi
  done
  [[ -n "$dmg_python" ]] || fail "未找到 DMG 打包工具。请用 Python 3.11+ 创建 dist/.dmg-tools 虚拟环境，并安装 Scripts/dmg-requirements.txt。"
fi

stage="$(mktemp -d "$releases/.any2webp-release.XXXXXXXX")"
[[ -d "$stage" && "$stage" == "$releases/.any2webp-release."* ]] || fail "无法创建发布暂存目录。"
scratch=""
mounted=false
cleanup() {
  if $mounted && ! hdiutil detach "$scratch/mounted" >/dev/null; then
    printf '无法卸载验证用磁盘映像，已保留挂载点和待验收目录：%s、%s\n' "$scratch/mounted" "$stage" >&2
    return
  elif [[ -n "$scratch" ]]; then
    rm -rf "$scratch"
  fi
  rm -rf "$stage"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
temp_root="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
scratch="$(mktemp -d "$temp_root/any2webp-release.XXXXXXXX")"
if [[ ! -d "$scratch" || "$scratch" != "$temp_root/any2webp-release."* ]]; then
  scratch=""
  fail "无法创建临时安装器目录。"
fi
mkdir -p "$scratch/image" "$scratch/mounted"
ANY2WEBP_DIST="$scratch/image" ./Scripts/build-app.sh
app="$scratch/image/$name.app"
if [[ "$mode" != "--preview" ]]; then
  after_revision="$(git rev-parse HEAD)"
  changes="$(git status --porcelain)"
  [[ "$after_revision" == "$revision" && -z "$changes" ]] ||
    fail "构建期间源码状态发生变化，请重新构建。"
fi
if [[ "$mode" == "--stable" ]]; then
  codesign --force --options runtime --timestamp --sign "$identity" "$app/Contents/MacOS/any2webp-codec"
  codesign --force --options runtime --timestamp --sign "$identity" "$app"
fi
codesign --verify --deep --strict "$app"

artifact="$name-$version-arm64$suffix.dmg"
image="$stage/$artifact"
background="$scratch/background.png"
/usr/bin/swift Scripts/create-dmg-background.swift "$background" "$name" "$min_version"
PYTHONDONTWRITEBYTECODE=1 "$dmg_python" -m dmgbuild -s Scripts/dmg-layout.py \
  -D app="$app" -D background="$background" "$name $version${suffix:+ Preview}" "$image"
if [[ "$mode" == "--stable" ]]; then
  codesign --timestamp --sign "$identity" "$image"
  xcrun notarytool submit "$image" --keychain-profile "$profile" --wait --output-format json > "$scratch/notary.json"
  [[ "$(plutil -extract status raw -o - "$scratch/notary.json")" == "Accepted" ]] ||
    fail "Apple 公证未通过，提交 ID：$(plutil -extract id raw -o - "$scratch/notary.json")"
  xcrun stapler staple "$image"
  xcrun stapler validate "$image"
  codesign --verify "$image"
  spctl --assess --type open --context context:primary-signature "$image"
fi

hdiutil verify "$image"
if ! hdiutil attach "$image" -mountpoint "$scratch/mounted" -readonly -nobrowse -noautoopen; then
  [[ ! -d "$scratch/mounted/$name.app" ]] || mounted=true
  fail "无法挂载待验收的磁盘映像。"
fi
mounted=true
bundle="$scratch/mounted/$name.app/Contents"
codesign --verify --deep --strict "$bundle/.."
PYTHONDONTWRITEBYTECODE=1 "$dmg_python" Scripts/dmg-layout.py "$scratch/mounted" "$name.app"
[[ "$(plutil -extract CFBundleIdentifier raw -o - "$bundle/Info.plist")" == "$identifier" ]] || fail "包标识不一致。"
[[ "$(plutil -extract CFBundleShortVersionString raw -o - "$bundle/Info.plist")" == "$version" ]] || fail "包版本不一致。"
[[ "$(plutil -extract LSMinimumSystemVersion raw -o - "$bundle/Info.plist")" == "$min_version" ]] || fail "最低系统版本不一致。"
for notice in LICENSE THIRD-PARTY-NOTICES.txt libwebp-PATENTS.txt RUST-NOTICES.txt; do
  [[ -s "$bundle/Resources/$notice" ]] || fail "安装包缺少许可文件：$notice"
done
for executable in any2webp any2webp-codec; do
  binary="$bundle/MacOS/$executable"
  [[ "$(lipo -archs "$binary")" == "arm64" ]] || fail "$executable 架构不是 arm64。"
  xcrun vtool -show-build "$binary" | awk -v min="$min_version" '
    $1 == "platform" && $2 == "MACOS" { macos = 1 }
    $1 == "minos" && $2 == min { deployment = 1 }
    END { exit !(macos && deployment) }' || fail "$executable 的最低 macOS 版本不一致。"
done
hdiutil detach "$scratch/mounted"
mounted=false

(cd "$stage" && shasum -a 256 "$artifact" > "$artifact.sha256" && shasum -a 256 -c "$artifact.sha256")
if [[ "$mode" != "--preview" ]]; then
  printf 'repository=https://github.com/%s\ntag=%s\ncommit=%s\ntree=%s\narchitecture=arm64\nminimum_macos=%s\nsigning=%s\nnotarization=%s\n' \
    "$repo" "$tag" "$revision" "$source_tree" "$min_version" "$signing" "$notarization" > "$stage/$artifact.source.txt"
fi
# Darwin's exclusive rename also refuses to move the staging directory inside
# an output directory that was created by a concurrent build.
python3 - "$stage" "$output" <<'PYTHON'
import ctypes
import os
import sys

rename = ctypes.CDLL(None, use_errno=True).renamex_np
rename.argtypes = (ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint)
RENAME_EXCL = 0x00000004
source, destination = sys.argv[1:]
if rename(os.fsencode(source), os.fsencode(destination), RENAME_EXCL) != 0:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error), destination)
PYTHON
printf '发布产物：%s\n' "$output/$artifact"
