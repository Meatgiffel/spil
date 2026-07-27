#!/usr/bin/env bash
#
# Daglig app-niveau-backup. Containeren dækkes af PBS (CT 125), men en
# databasekopi gør rollback efter en dårlig migration triviel — det er præcis
# det hul indkob har flagget som P2 i sit eget hardening-dokument.
set -euo pipefail

DATA_DIR="/var/lib/spil"
DB_PATH="${DATA_DIR}/spil.db"
BACKUP_DIR="${DATA_DIR}/backups"
KEEP_DAYS=14

[[ -f "${DB_PATH}" ]] || exit 0

mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d-%H%M%S)"

# VACUUM INTO frem for cp: databasen kører i WAL-tilstand, og en filkopi taget
# under skrivning kan give en kopi der ikke kan åbnes.
sqlite3 "${DB_PATH}" "VACUUM INTO '${BACKUP_DIR}/spil-${STAMP}.db'"

find "${BACKUP_DIR}" -name 'spil-*.db' -type f -mtime "+${KEEP_DAYS}" -delete

echo "Backup: ${BACKUP_DIR}/spil-${STAMP}.db"
