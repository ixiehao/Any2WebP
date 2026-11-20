#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
arch="$(uname -m)"
case "$arch" in
  arm64) triple=aarch64-apple-darwin ;;
  x86_64) triple=x86_64-apple-darwin ;;
  *) echo "Unsupported macOS architecture: $arch" >&2; exit 1 ;;
esac

webp="$(brew --prefix webp)"
gif="$(brew --prefix giflib)"
min_version="$(plutil -extract bundle.macOS.minimumSystemVersion raw -o - src-tauri/tauri.conf.json)"
mkdir -p src-tauri/binaries
clang -std=c11 -O2 -ffp-contract=off -Wall -Wextra -Werror -mmacosx-version-min="$min_version" \
  -I"$webp/include" -I"$gif/include" engine/codec.c engine/adjustment.c \
  "$webp/lib/libwebpmux.a" "$webp/lib/libwebpdemux.a" \
  "$webp/lib/libwebp.a" "$webp/lib/libsharpyuv.a" "$gif/lib/libgif.a" \
  -framework CoreFoundation -framework CoreGraphics -framework ImageIO -lz \
  -o "src-tauri/binaries/any2webp-codec-$triple"

scratch="$(mktemp -d)"
trap 'rm -f "$scratch/adjustment.o" "$scratch/adjustment.wasm"; rmdir "$scratch"' EXIT
wasm_clang="${ANY2WEBP_WASM_CLANG:-clang}"
"$wasm_clang" --target=wasm32-unknown-unknown -std=c11 -O3 -ffp-contract=off -ffreestanding -fno-builtin \
  -Wall -Wextra -Werror -c engine/adjustment.c -o "$scratch/adjustment.o"
"$(rustc --print target-libdir)/../bin/rust-lld" -flavor wasm --no-entry \
  --export=adjust_rgba --export=__heap_base --strip-all "$scratch/adjustment.o" -o "$scratch/adjustment.wasm"
if ! cmp -s "$scratch/adjustment.wasm" app/adjustment.wasm; then
  install -m 644 "$scratch/adjustment.wasm" app/adjustment.wasm
fi
