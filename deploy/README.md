# Deployment

Appen kører i en unprivilegeret Debian-LXC på Proxmox-clusteret "Asgard", efter samme mønster som
indkob (CT 110): tagget release → GitHub Actions bygger en tarball → containeren henter den og
laver et atomisk symlink-swap. Der bygges **intet** på serveren.

## Sikkerhedsregel

Overtaget fra indkobs runbook. Ved live deployment skal der altid være **eksplicit godkendelse**
lige før den kommando der faktisk opdaterer:

1. Find den aktive host-node — containeren kan flytte mellem noder.
2. Verificér containerens status.
3. Vis den konkrete kommando til brugeren.
4. Kør først efter et tydeligt ja.

Proxmox-noder: `thor` .225, `odin` .226, `frigg` .227, `balder` .228.

```bash
ssh root@192.168.50.225 "pvesh get /cluster/resources --type vm --output-format json" \
  | jq -r '.[] | select(.vmid==130) | "vmid=\(.vmid) node=\(.node) status=\(.status)"'
```

## Containeren

| | |
|---|---|
| CT | 130, navn `spil` |
| Type | Unprivilegeret Debian 13 |
| RAM | 1 GB (Node fylder mere end de 0.5 GB CT 110/120 bruger) |
| Cores | 2 |
| Rootfs | 8 GB på `proxmox-data` |
| HA | Ja, som CT 110 og 120 |

## Førstegangsopsætning

Containeren har hverken git eller repoet, så `deploy/`-mappen skubbes ind fra Proxmox-noden:

```bash
NODE=192.168.50.228          # den node pvesh-kommandoen ovenfor pegede på
tar -czf /tmp/spil-deploy.tar.gz -C ~/Workspace/spil deploy
scp /tmp/spil-deploy.tar.gz root@$NODE:/tmp/
ssh root@$NODE 'pct push 130 /tmp/spil-deploy.tar.gz /tmp/spil-deploy.tar.gz'
ssh root@$NODE 'pct exec 130 -- bash -c "cd /tmp && tar xzf spil-deploy.tar.gz && bash deploy/lxc-bootstrap.sh Meatgiffel/spil"'
```

`lxc-bootstrap.sh` er idempotent. Den installerer nginx, Node 22 fra NodeSource og sqlite3,
opretter servicebrugeren `spil`, mapperne, systemd-unit'en, backup-timeren og nginx-vhosten —
og henter så den første release.

Bagefter:

1. Ret `PUBLIC_URL` og `TRUSTED_ORIGINS` i `/etc/spil/spil.env` til det navn appen nås på udefra.
   Gør du ikke det, bliver session-cookien afvist. Derefter `systemctl restart spil-api`.
2. Opret en proxy-host i nginxproxymanager (CT 104) mod containerens IP, port 80.
3. Åbn appen. Første besøg viser opsætningssiden, hvor du opretter administratoren.

## Opdatering

```bash
ssh root@$NODE 'pct exec 130 -- /usr/local/bin/spil-update Meatgiffel/spil'
```

Rækkefølgen i scriptet er `VACUUM INTO`-backup → udpak → migrations → symlink-swap → restart →
health-tjek. Migrationerne køres mod den nye kode men **før** servicen skifter til den, så en
dårlig migration efterlader den gamle version kørende.

## Rollback

De sidste fem releases bliver liggende, så rollback er et symlink-skift:

```bash
ssh root@$NODE 'pct exec 130 -- bash -c "
  ls -1dt /opt/spil/releases/*/ | head -5
"'
ssh root@$NODE 'pct exec 130 -- bash -c "
  ln -sfn /opt/spil/releases/<stempel> /opt/spil/current && systemctl restart spil-api
"'
```

Var problemet en migration, skal databasen også rulles tilbage fra
`/var/lib/spil/backups/` — skemaet er ikke nedadkompatibelt.

## Udgivelse af en ny version

```bash
git tag v0.2.0 && git push origin v0.2.0
```

Workflowet kører `npm test` før det bygger. Fejler testene, bliver der ingen release — en tagget
version er det eneste der nogensinde rammer serveren.

## Hvad ligger hvor

| Ting | Sti |
|---|---|
| Releases | `/opt/spil/releases/<stempel>`, `current`-symlink, sidste 5 beholdes |
| API | `/opt/spil/api` → `current/api`, lytter på `127.0.0.1:5060` |
| Web | `/var/www/spil` → `current/www`, serveret af nginx på `:80` |
| Database | `/var/lib/spil/spil.db` (WAL) |
| Uploads | `/var/lib/spil/uploads` |
| Backups | `/var/lib/spil/backups`, dagligt kl. 03:17, 14 dages opbevaring |
| Hemmeligheder | `/etc/spil/spil.env`, mode 0600 |

Data ligger i `/var/lib/spil` og releases i `/opt/spil` — netop for at en opdatering aldrig kan
røre databasen. Containeren backes desuden op af PBS (CT 125); app-backuppen findes fordi den gør
rollback efter en dårlig migration triviel.
