# CLAUDE.md — Spil

Selvhostet app til at holde styr på hvilke brætspil man har spillet med sine venner.
Offline-first PWA, hostet i en LXC på Proxmox-clusteret "Asgard".

**Status: appen er bygget og testet lokalt. Deployment er ikke lavet.** Alt under `deploy/`,
`scripts/release.sh` og GitHub Actions mangler stadig — se `PLAN.md` trin 9. Mappen er heller ikke
et git-repo endnu.

| Fil | Indhold |
|---|---|
| `PLAN.md` | Fuld implementeringsplan — stack, datamodel, sync-protokol, hosting, rækkefølge, verifikation |
| `DESIGN-BRIEF.md` | Selvstændig brief til Claude Design |
| `DESIGN-IMPORT.md` | Importinstruktion til Claude Design-projektet, plus filliste |
| `BESLUTNINGER.md` | Trufne valg med begrundelser, plus åbne punkter. **Hold den opdateret** |

---

## Stack

TypeScript overalt. Node 22 + Express 5 + Drizzle ORM + SQLite (`better-sqlite3`) i backend.
React 19 + Vite + Dexie 4 (IndexedDB) i frontend. Better Auth til login. zod til validering,
delt mellem klient og server via `shared/`. npm workspaces: `shared`, `server`, `client`.

Intet UI-komponentbibliotek og ingen Tailwind — håndskrevet CSS med custom properties.
**Ingen eksterne fonte eller CDN-assets**, appen skal kunne bygges og køre offline.

---

## Konventioner

**Sprog.** Al brugervendt tekst er på dansk — hold det sådan. `<html lang="da">`.
Kode-identifikatorer er engelske, men **kommentarer skrives på dansk**, som i flagdag.
Datoer via `Intl.DateTimeFormat("da-DK", …)`, sortering via `localeCompare(…, "da")`.
CSV-eksport bruger `;` som separator, `\r\n` og UTF-8 BOM.

**Stil.** 2 spaces, dobbelte anførselstegn, semikolon, ESM med navngivne eksporter.
Hjælpefunktioner placeres under de ruter der bruger dem. Ingen linter er sat op — hold det
konsistent i hånden.

**Struktur.** `server/src/app.ts` eksporterer `app` og lytter ikke; `server/src/index.ts` starter
serveren. Det gør det muligt for tests at importere appen direkte.

**Validering.** zod `safeParse` på alt input, med skemaet importeret fra `shared/` så klient og
server validerer ens. Ved fejl: returnér 400 med feltspecifikke fejl, og bevar brugerens input i UI'et.

**Autorisation.** Adgangsgrænsen er **gruppen**. Der findes præcis én funktion,
`assertGroupAccess(userId, groupId)`, og enhver rute der rører gruppedata kalder den. Læg ikke
adgangstjek ud i de enkelte handlers.

**ID'er.** UUIDv7, **genereret på klienten**, så offline-oprettelser aldrig kolliderer.
Serveren accepterer klientens id — den må ikke omskrive det.

**Sync-kolonner.** Hver synkroniseret tabel har `updated_at` (klientens tid, kun til last-write-wins)
og `server_seq` (serverens monotone tæller, kun til sync-cursor). De to må aldrig slås sammen.
`server_seq` har bevidst ingen default: **enhver** serverside-skrivning til en synkroniseret tabel
skal kalde `allocateServerSeq()`, ellers bliver rækken aldrig hentet af nogen klient.

**Sletning.** Soft delete via `deleted_at`. Hard delete bryder sync, fordi klienter så aldrig
får at vide at rækken er væk.

**Databaseændringer.** `server/src/db/schema.ts` er eneste kilde til sandhed. Skemaændring =
ret schema.ts → `drizzle-kit generate` → commit migrationen. Skriv aldrig rå `CREATE TABLE`
ved siden af (det er præcis den fælde flagdag sidder i med Prisma + `scripts/setup-db.js`).

**Hemmeligheder.** Aldrig i repoet, aldrig i systemd-unit'en. `/etc/spil/spil.env`, mode 0600,
indlæst med `EnvironmentFile=`. `.env` og `*.db` er gitignored.

---

## Kørsel lokalt

```bash
npm install
npm run db:migrate        # drizzle-kit migrations mod dev.db
npm run dev               # server (:5060) + vite dev server (:5173)
npm test                  # node --test (backend) + vitest (klientens sync-motor)
npm run test:e2e          # Playwright: offline-flowet, mod en produktionsbygning
npm run typecheck         # tsc --noEmit på server og klient
```

Serveren kræver disse env-variabler (ingen `.env` i repoet):

```bash
BETTER_AUTH_SECRET=<mindst 32 tegn>   # openssl rand -hex 32
DATABASE_PATH=./dev.db
UPLOADS_DIR=./uploads
PUBLIC_URL=http://localhost:5173
TRUSTED_ORIGINS=http://localhost:5173
```

Tests booter den rigtige Express-app mod en temp-SQLite med env-variabler sat i testen — se
`server/test/helpers.ts`. Ingen `.env` skal være til stede.

---

## Produktion

Kører i en **unprivilegeret Debian-LXC** på Proxmox-clusteret "Asgard", modelleret efter
CT 110 (indkob) og CT 120 (flagplan). Foreslået CT 130 "spil". TLS termineres opad i
nginxproxymanager (CT 104) — der er ingen TLS i containeren.

| Ting | Værdi |
|---|---|
| Web (nginx) | `:80`, root `/var/www/spil` → symlink til `/opt/spil/current/www` |
| API | `127.0.0.1:5060`, proxyet på `/api` |
| SQLite | `/var/lib/spil/spil.db` (WAL) — overlever opdateringer |
| Uploads | `/var/lib/spil/uploads`, serveret af nginx på `/uploads` |
| Hemmeligheder | `/etc/spil/spil.env` (0600) |
| Backups | `/var/lib/spil/backups/`, `VACUUM INTO`, 14 dages opbevaring |
| Releases | `/opt/spil/releases/<timestamp>`, `current`-symlink, sidste 5 beholdes |
| Servicebruger | `spil` (systembruger, `/usr/sbin/nologin`) |

Deploy sker ved at tagge `v*` → GitHub Actions bygger en tarball → `lxc-update.sh` i containeren
henter latest release og laver atomisk symlink-swap. Containeren behøver kun Node 22 fra NodeSource;
der bygges intet på serveren.

### Sikkerhedsregel ved live deployment

Overtaget fra indkobs runbook, og den gælder også her:

1. Find den aktive host-node først — containeren kan flytte mellem noder:
   ```bash
   ssh root@192.168.50.225 "pvesh get /cluster/resources --type vm --output-format json" \
     | jq -r '.[] | select(.vmid==130) | "vmid=\(.vmid) node=\(.node)"'
   ```
2. Verificér status på containeren.
3. **Vis den konkrete update-kommando til brugeren og spørg om den må køres.**
4. Kør først efter et tydeligt ja.

Proxmox-noder: `thor` .225, `odin` .226, `frigg` .227, `balder` .228.
Se `~/Workspace/server/homelab-plan.md` for cluster-kontekst.

Backup af selve containeren håndteres af PBS (CT 125). App-niveau-backuppen findes alligevel,
fordi den gør rollback efter en dårlig migration triviel.

---

## Verifikation

Kør `npm test` før commit. Rører ændringen offline-adfærd eller sync, så kør også `npm run test:e2e`
— den opretter et parti offline, genindlæser uden net, går online og verificerer at partiet dukker
op i en anden browser-kontekst. Den kører mod en produktionsbygning, fordi service worker'en kun
findes dér.

Testene har allerede fanget fire fejl der ikke kunne ses i koden: sync-loopet der rev sig selv ned,
`pending`-markeringen der aldrig blev ryddet, en Dexie-skemafejl der slog synkroniseringen ihjel i
stilhed, og et race hvor man kunne gå offline før ens egen spiller-række var hentet. Spring dem
ikke over.
