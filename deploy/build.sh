#!/bin/sh
# Builds the personal instance into deploy/out: the web API for x86-64 Linux (Debian 12, built in Docker on any
# machine) and the static site.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/deploy/out"
mkdir -p "$out"

# Nightly, like the repository's toolchain; bookworm, like the server, so the binary links against its glibc.
docker run --rm --platform linux/amd64 \
  -v "$root":/src \
  -v courses-cargo-registry:/usr/local/cargo/registry \
  -v courses-cargo-git:/usr/local/cargo/git \
  -v courses-target:/target \
  -e CARGO_TARGET_DIR=/target \
  -e CARGO_UNSTABLE_CODEGEN_BACKEND=true \
  -w /src \
  rustlang/rust:nightly-bookworm \
  sh -c 'cargo build --release --locked -p courses-web-api && cp /target/release/courses-web-api /src/deploy/out/courses-web-api'

(cd "$root/sites/web" && deno task build)
rm -rf "$out/site"
cp -R "$root/sites/web/build" "$out/site"
echo "Built $out/courses-web-api and $out/site"
