#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../rust"
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --offline -- -D warnings
cargo test --workspace --offline
cargo build -p pc-wasm --release --target wasm32-unknown-unknown --offline
cp target/wasm32-unknown-unknown/release/pc_wasm.wasm ../wasm/pc_wasm.wasm
