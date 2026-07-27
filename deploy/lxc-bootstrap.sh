#!/usr/bin/env bash
#
# Førstegangsopsætning af LXC'en. Køres inde i containeren, som root:
#
#   ./lxc-bootstrap.sh Meatgiffel/spil
#
# Idempotent — den kan køres igen uden at ødelægge data.
set -euo pipefail

REPO="${1:-${SPIL_REPO:-}}"
if [[ -z "${REPO}" ]]; then
  echo "Brug: $0 <ejer/repo>" >&2
  exit 1
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Skal køres som root (sudo)." >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Pakker"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nginx ca-certificates curl gnupg tar sqlite3

# Node 22 fra NodeSource. Containeren skal kun kunne *køre* appen — der bygges
# intet på serveren, så npm og build-værktøj er ikke nødvendigt.
if ! command -v node >/dev/null || [[ "$(node -v)" != v22.* ]]; then
  echo "==> Node 22 fra NodeSource"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi
node -v

echo "==> Bruger og mapper"
useradd -r -s /usr/sbin/nologin spil 2>/dev/null || true
install -d -o spil -g spil /opt/spil /opt/spil/releases
install -d -o spil -g spil /var/lib/spil /var/lib/spil/uploads /var/lib/spil/backups
install -d -o www-data -g www-data /var/www

echo "==> Hemmeligheder"
install -d -m 0700 /etc/spil
if [[ ! -f /etc/spil/spil.env ]]; then
  # Genereres én gang. Skiftes den, bliver alle logget ud.
  SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat >/etc/spil/spil.env <<EOF
NODE_ENV=production
PORT=5060
DATABASE_PATH=/var/lib/spil/spil.db
UPLOADS_DIR=/var/lib/spil/uploads
BETTER_AUTH_SECRET=${SECRET}
# Ret de to herunder til det navn appen nås på udefra, ellers bliver
# session-cookien afvist.
PUBLIC_URL=https://spil.example.dk
TRUSTED_ORIGINS=https://spil.example.dk
EOF
  chmod 0600 /etc/spil/spil.env
  echo "    /etc/spil/spil.env oprettet — ret PUBLIC_URL og TRUSTED_ORIGINS før brug."
else
  echo "    /etc/spil/spil.env findes allerede, rører den ikke."
fi

echo "==> systemd"
install -m 0755 "${HERE}/lxc-update.sh" /usr/local/bin/spil-update
install -m 0644 "${HERE}/spil-api.service" /etc/systemd/system/spil-api.service
install -m 0755 "${HERE}/spil-backup.sh" /usr/local/bin/spil-backup
install -m 0644 "${HERE}/spil-backup.service" /etc/systemd/system/spil-backup.service
install -m 0644 "${HERE}/spil-backup.timer" /etc/systemd/system/spil-backup.timer
systemctl daemon-reload
systemctl enable spil-api.service
systemctl enable --now spil-backup.timer

echo "==> nginx"
install -d /etc/nginx/sites-available /etc/nginx/sites-enabled
install -m 0644 "${HERE}/nginx-spil.conf" /etc/nginx/sites-available/spil
ln -sfn /etc/nginx/sites-available/spil /etc/nginx/sites-enabled/spil
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx

echo "==> Første release"
/usr/local/bin/spil-update "${REPO}"

cat <<'EOF'

Færdig.

  1. Ret PUBLIC_URL og TRUSTED_ORIGINS i /etc/spil/spil.env til det rigtige navn,
     og kør: systemctl restart spil-api
  2. Opret en proxy-host i nginxproxymanager (CT 104) der peger på denne container.
  3. Åbn appen — første besøg viser opsætningssiden, hvor du opretter administratoren.

EOF
