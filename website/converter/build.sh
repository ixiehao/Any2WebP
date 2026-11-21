#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
target=wasm32-unknown-unknown
cargo build --manifest-path Cargo.toml --target "$target" --release --locked --target-dir target
python3 ../../Scripts/collect-rust-notices.py "$target" target/ONLINE-CONVERTER-NOTICES.txt Cargo.toml
