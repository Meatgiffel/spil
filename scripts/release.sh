#!/usr/bin/env bash
#
# Bygger release-bundtet i release/:
#
#   release/api/   serveren som ét bundle + migrations + better-sqlite3
#   release/www/   den byggede SPA + version.json
#
# Køres af GitHub Actions, men virker også lokalt.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/release"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}/api" "${OUT_DIR}/www"

echo "==> Bygger"
cd "${ROOT_DIR}"
npm run build --workspace @spil/shared
npm run build --workspace @spil/server
npm run build --workspace @spil/client

cp -R "${ROOT_DIR}/server/dist/." "${OUT_DIR}/api/"
cp -R "${ROOT_DIR}/client/dist/." "${OUT_DIR}/www/"

# better-sqlite3 er et native modul og kan ikke bundles. Det installeres for
# sig, så releasen kun indeholder præcis den ene runtime-afhængighed.
echo "==> better-sqlite3"
BETTER_SQLITE_VERSION="$(node -p "require('${ROOT_DIR}/server/package.json').dependencies['better-sqlite3']")"
cat >"${OUT_DIR}/api/package.json" <<EOF
{
  "name": "spil-api",
  "private": true,
  "type": "module",
  "dependencies": {
    "better-sqlite3": "${BETTER_SQLITE_VERSION}"
  }
}
EOF
npm install --omit=dev --no-audit --no-fund --prefix "${OUT_DIR}/api"

# Frontenden viser den her, så man kan se hvad der faktisk er deployet.
VERSION="${GITHUB_REF_NAME:-$(git -C "${ROOT_DIR}" describe --tags --always --dirty 2>/dev/null || echo dev)}"
COMMIT="$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
cat >"${OUT_DIR}/www/version.json" <<EOF
{ "version": "${VERSION}", "commit": "${COMMIT}", "builtAtUtc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
EOF

echo "==> Klar i ${OUT_DIR} (${VERSION})"
