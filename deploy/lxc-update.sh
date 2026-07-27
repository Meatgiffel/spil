#!/usr/bin/env bash
#
# Henter seneste release fra GitHub og skifter til den med et atomisk
# symlink-swap. Køres inde i containeren, som root.
#
#   spil-update Meatgiffel/spil
#
# Rækkefølgen er vigtig: backup → udpak → migrations → restart. Migrationerne
# køres mens den gamle version stadig kører, og backuppen ligger klar hvis en
# migration viser sig at være dårlig.
set -euo pipefail

REPO="${1:-${SPIL_REPO:-}}"
if [[ -z "${REPO}" ]]; then
  echo "Brug: $0 <ejer/repo>" >&2
  exit 1
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Skal køres som root." >&2
  exit 1
fi

ASSET_NAME="spil-release-linux-x64.tar.gz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}"

RELEASES_DIR="/opt/spil/releases"
CURRENT_DIR="/opt/spil/current"
API_LINK="/opt/spil/api"
WWW_LINK="/var/www/spil"
DATA_DIR="/var/lib/spil"
BACKUP_DIR="${DATA_DIR}/backups"
DB_PATH="${DATA_DIR}/spil.db"
KEEP_RELEASES=5

ARCH="$(uname -m)"
if [[ "${ARCH}" != "x86_64" ]]; then
  echo "Dette script er kun sat op til x86_64 (fik: ${ARCH})." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "==> Henter ${ASSET_NAME}"
curl -fL --retry 3 "${DOWNLOAD_URL}" -o "${TMP_DIR}/${ASSET_NAME}"

# Backup før noget som helst røres. VACUUM INTO frem for cp: databasen kører i
# WAL-tilstand, og en filkopi under skrivning kan give en inkonsistent kopi.
if [[ -f "${DB_PATH}" ]]; then
  install -d -o spil -g spil "${BACKUP_DIR}"
  STAMP_DB="$(date +%Y%m%d-%H%M%S)"
  echo "==> Backup til ${BACKUP_DIR}/spil-${STAMP_DB}.db"
  su -s /bin/sh spil -c \
    "sqlite3 '${DB_PATH}' \"VACUUM INTO '${BACKUP_DIR}/spil-${STAMP_DB}.db'\""
fi

STAMP="$(date +%Y%m%d%H%M%S)"
DEST="${RELEASES_DIR}/${STAMP}"
echo "==> Pakker ud i ${DEST}"
mkdir -p "${DEST}"
tar -xzf "${TMP_DIR}/${ASSET_NAME}" -C "${DEST}"

if [[ ! -f "${DEST}/api/index.js" || ! -f "${DEST}/www/index.html" ]]; then
  echo "Releasen ser forkert ud — ruller ikke frem." >&2
  rm -rf "${DEST}"
  exit 1
fi

chown -R spil:spil "${DEST}/api"
chown -R www-data:www-data "${DEST}/www"

# Migrationer mod den nye kode, men før den nye kode kører. Fejler de, står den
# gamle version stadig og kører.
echo "==> Kører migrations"
set -a
# shellcheck disable=SC1091
. /etc/spil/spil.env
set +a
su -s /bin/sh spil -c "cd '${DEST}/api' && SPIL_MIGRATE_ONLY=1 /usr/bin/node index.js"

echo "==> Skifter symlinks"
ln -sfn "${DEST}" "${CURRENT_DIR}"
ln -sfn "${CURRENT_DIR}/api" "${API_LINK}"
ln -sfn "${CURRENT_DIR}/www" "${WWW_LINK}"

systemctl restart spil-api
systemctl reload nginx || true

sleep 2
if ! curl -fsS http://127.0.0.1:5060/api/health >/dev/null; then
  echo "API svarer ikke efter opdatering — se: journalctl -u spil-api -n 50" >&2
  exit 1
fi

echo "==> Opdateret til ${STAMP}"

# Behold de sidste par releases, så rollback er et symlink-skift væk.
ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null | tail -n "+$((KEEP_RELEASES + 1))" | xargs -r rm -rf
