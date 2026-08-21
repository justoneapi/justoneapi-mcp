#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
smoke_root="$(mktemp -d "${TMPDIR:-/tmp}/justoneapi-mcp-pack.XXXXXX")"

cleanup() {
  rm -rf -- "$smoke_root"
}
trap cleanup EXIT

cd "$project_root"
npm pack --ignore-scripts --pack-destination "$smoke_root"

set -- "$smoke_root"/*.tgz
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Expected exactly one npm tarball in the temporary directory." >&2
  exit 1
fi
tarball="$1"

tar -tzf "$tarball" > "$smoke_root/tar-files.txt"
if grep -E '^package/(scripts/|dist/scripts/|src/worker([./]|$)|dist/src/worker([./]|$)|wrangler([./]|$)|wrangler\.jsonc$|worker-configuration\.d\.ts$|\.dev\.vars|.*\.pem$)' "$smoke_root/tar-files.txt"; then
  echo "The npm tarball contains Worker, build-script, Wrangler, or secret-only files." >&2
  exit 1
fi

install_root="$smoke_root/install"
mkdir "$install_root"
cd "$install_root"
npm init --yes >/dev/null
npm install --package-lock-only --ignore-scripts --no-audit --no-fund "$tarball"
npm ci --ignore-scripts --no-audit --no-fund

cd "$project_root"
"$project_root/node_modules/.bin/tsx" scripts/smoke-packed-cli.ts "$install_root"
