#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
export MACOSX_DEPLOYMENT_TARGET
MACOSX_DEPLOYMENT_TARGET="$(plutil -extract bundle.macOS.minimumSystemVersion raw -o - src-tauri/tauri.conf.json)"

for script in Scripts/*.sh; do bash -n "$script"; done
./Scripts/build-codec.sh
python3 -B Tests/test_codec.py
for module in app/*.js; do node --check "$module"; done
for test in Tests/*.mjs; do node "$test"; done
cargo test --manifest-path src-tauri/Cargo.toml --release --locked --features tauri/custom-protocol
