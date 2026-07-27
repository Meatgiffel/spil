# Plan: "Spil" — offline-first PWA til brætspils-historik

## Kontekst

Du vil have en ny selvhostet service, der holder styr på hvilke brætspil du og dine venner har spillet.
Krav fra dig: rigtigt login (eksisterende bibliotek, ikke hjemmestrikket), selvregistrering gated af en
invite-"key" udstedt af en admin, grupper af spillere hvor medlemmer både kan være rigtige konti og
gæster uden konto, mobile-first, SPA, offline-first, hostet i en LXC ligesom dine andre apps.

To hosting-mønstre findes allerede i workspacet, og de er forskellige:

- **flagdag** (CT 120): git clone i containeren, `git pull` + `systemctl restart`, Express serverer selv
  statiske filer, ingen nginx, ingen deploy-artefakter i repoet. Prisma bruges kun til klient-generering
  mens skemaet i virkeligheden laves af `scripts/setup-db.js` — deres egen CLAUDE.md kalder det ud som
  en fælde.
- **indkob** (CT 110): tag → GitHub Actions bygger en tarball → `lxc-update.sh` henter latest release og
  laver atomisk symlink-swap. nginx serverer SPA'en og reverse-proxyer en localhost-bundet API.
  Deploy-scripts, systemd-unit og nginx-vhost ligger i repoet under `deploy/`.

**Beslutning: vi kopierer indkobs deployment-skelet**, fordi den nye service er præcis samme form
(SPA + API + SQLite + PWA). Vi tager flagdags *konventioner* med (dansk UI og danske kommentarer,
zod-validering, `node --test`-integrationstest der booter den rigtige app mod en temp-DB, app'en
eksporterer `app` og lytter kun ved direkte kørsel).

Vi undgår bevidst: indkobs `admin/changeme`-bootstrap med plaintext-logning af password og dets
`AllowAnyOrigin`-CORS-fallback (begge P0 i deres eget `docs/hardening-plan.md`), samt flagdags
dobbelte skema-kilde og manuelle `cp`-backup.

### Dine valg (fra afklaringsrunden)

| Emne | Valg |
|---|---|
| Offline | Fuld offline med sync — IndexedDB er sandheden på klienten, ændringer køes og synkes |
| Spil-titler | Manuel oprettelse + BoardGameGeek-opslag med server-side cache |
| Parti-data | Vinder + placering, dato/sted/varighed, noter og billeder (**ikke** point pr. spiller) |
| Auth | Better Auth |

---

## Stack

| Lag | Valg | Hvorfor |
|---|---|---|
| Sprog | TypeScript overalt | Delte typer mellem klient/server er hele pointen når man selv skriver en sync-motor |
| Backend | Node 22 + Express 5 | Samme familie som flagdag; Better Auth har officiel Express-handler |
| DB | SQLite + **Drizzle ORM** + drizzle-kit migrations | Én skema-kilde (undgår flagdags Prisma/raw-SQL-split). Better Auth har officiel Drizzle-adapter |
| SQLite-driver | `better-sqlite3` | Synkron, WAL, prebuilt binaries. `node:sqlite` er stadig eksperimentel på Node 22 |
| Auth | `better-auth` ^1.6 | Email+kodeord, sessions i SQLite, `admin`-plugin til roller, senere passkeys uden omskrivning |
| Frontend | React 19 + Vite + TypeScript | |
| Routing | React Router (data router) | |
| Lokal DB | **Dexie 4** (IndexedDB) + `dexie-react-hooks` | `useLiveQuery` gør UI'et reaktivt på lokal data — ingen server-state-bibliotek nødvendigt |
| PWA | `vite-plugin-pwa` (Workbox) | Precache af app-shell, manifest, auto-update |
| Validering | zod (delt mellem klient og server) | Samme mønster som flagdag |
| Test | `node --test` (backend), Vitest (sync-motor), Playwright (offline-flow) | |

Ingen UI-komponentbibliotek. Håndskrevet CSS med CSS custom properties, som flagdags `styles.css`,
men mobile-first: én kolonne som udgangspunkt, `env(safe-area-inset-*)`, bund-navigation med
touch-targets ≥ 44px, `@media (min-width: 720px)` som eneste breakpoint opad.

---

## Repo-layout

```
/home/casper/Workspace/spil/
├── CLAUDE.md                  konventioner + deployment-runbook (som flagdags)
├── README.md                  dansk
├── package.json               npm workspaces: shared, server, client
├── shared/src/                zod-skemaer, delte typer, sync-protokollens DTO'er
├── server/
│   ├── src/index.ts           opsætning + listen (kun ved direkte kørsel)
│   ├── src/app.ts             eksporterer `app` så tests kan importere den
│   ├── src/db/schema.ts       Drizzle-skema (eneste skema-kilde)
│   ├── src/db/migrations/     genereret af drizzle-kit
│   ├── src/auth.ts            Better Auth-instans + invite-key-plugin
│   ├── src/routes/            sync.ts, groups.ts, games.ts, plays.ts, invites.ts, uploads.ts, bgg.ts
│   └── test/                  node --test, booter app mod temp-DB
├── client/
│   ├── src/db/local.ts        Dexie-skema + outbox
│   ├── src/db/sync.ts         sync-motoren
│   ├── src/routes/            sider
│   └── public/manifest + ikoner
├── deploy/                    spil-api.service, nginx-spil.conf, lxc-bootstrap.sh, lxc-update.sh
├── scripts/release.sh
└── .github/workflows/release.yml
```

---

## Datamodel

Alle domæne-tabeller har fire sync-kolonner: `id` (UUIDv7, **genereret på klienten** så offline-oprettelser
aldrig kolliderer), `updated_at` (ms epoch), `deleted_at` (nullable — soft delete, så sletninger kan
propagere) og `updated_by` (bruger-id).

**Auth-tabeller** (`user`, `session`, `account`, `verification`) ejes af Better Auth. `user` udvides med
`role` (`user` | `admin`) via admin-plugin'et og `display_name`.

**Domæne:**

- `invite_key` — `key_hash` (sha256, aldrig plaintext i DB), `created_by`, `label`, `max_uses`,
  `uses`, `expires_at`, `revoked_at`. Nøglen vises kun én gang ved oprettelse.
- `player` — den centrale abstraktion. `user_id` er **nullable**: er den sat, er spilleren en rigtig konto;
  er den `null`, er det en gæst. Har `name`, `created_by`. Et parti refererer altid `player_id`, aldrig `user_id`
  — så en gæst kan senere kobles til en konto uden at historik skal skrives om.
- `group` — `name`, `created_by`.
- `group_member` — `group_id` + `player_id` + `role` (`owner` | `member`). Unik på (`group_id`, `player_id`).
  Samme gæstespiller kan optræde i flere grupper.
- `game` — `title`, `bgg_id` (nullable), `year`, `min_players`, `max_players`, `thumbnail_path`, `created_by`.
- `play` — et spillet parti: `group_id`, `game_id`, `played_at`, `location`, `duration_minutes`, `notes`,
  `coop_result` (`null` | `won` | `lost`).
- `play_participant` — `play_id`, `player_id`, `placement` (1 = vinder, ties tilladt via samme tal),
  `score` **nullable**. Scorefeltet bygges ikke i UI'et nu — men kolonnen koster intet og gør det til en
  ren frontend-opgave at tilføje point senere, hvis du ombestemmer dig.
- `photo` — `play_id`, `file_path`, `width`, `height`, `taken_at`.
- `bgg_cache` — `query_hash` → rå JSON + `fetched_at`, så BGG ikke rammes på hvert tastetryk.

Adgangsgrænsen er **gruppen**: du ser præcis de rækker, der hører til grupper hvor du er medlem
(via en `player` med dit `user_id`). Det er både autorisationsreglen og sync-partitionen — samme regel
ét sted i koden, `assertGroupAccess(userId, groupId)`.

---

## Sync-motoren

Der findes ikke en færdig løsning der passer: ElectricSQL og PowerSync kræver Postgres, Triplit vil have
sin egen server. Til en SQLite-app i en LXC er en håndskrevet motor på ~300 linjer det rigtige valg.

**Protokol — to endpoints:**

`POST /api/sync/pull` med `{ since: <cursor> }` → alle rækker i brugerens grupper med
`updated_at > since`, grupperet pr. tabel, plus en ny `cursor` (server-tid). Soft-slettede rækker
kommer med, så klienten kan fjerne dem lokalt.

`POST /api/sync/push` med en liste af outbox-mutationer `{ opId, table, id, op, payload, updatedAt }`.
Serveren kører hele batchen i **én transaktion**, validerer med det delte zod-skema, tjekker
gruppeadgang pr. række og svarer med accepterede/afviste `opId`'er.

**Konfliktløsning:** last-write-wins på rækkeniveau, afgjort på `updated_at` med `id` som tiebreak.
Serveren afviser en push hvis dens egen `updated_at` er nyere — klienten tager så serverens version
i næste pull. Det er tilstrækkeligt her: to personer redigerer sjældent samme parti samtidigt, og
`play_participant` er splittet ud i egne rækker, så to personer der retter hver sin placering ikke
overskriver hinanden.

**Klienten:**

1. Alle skrivninger går til Dexie i én lokal transaktion sammen med en `outbox`-række. UI'et opdateres
   via `useLiveQuery` og venter aldrig på netværk.
2. En sync-loop kører ved app-start, ved `online`-event, ved `visibilitychange` og hvert 60. sekund:
   push outbox → pull siden cursor → anvend.
3. `opId` er en UUID, så en push der timeouter og gentages er idempotent (serveren husker sete `opId`'er
   i en `sync_op`-tabel).
4. Fotos: offline gemmes filen som Blob i Dexie og vises fra en `URL.createObjectURL`; outboxen uploader
   den til `POST /api/uploads` når der er net og bytter så den lokale reference ud med serverstien.

**Offline + auth:** Better Auth-sessionen er en cookie med 30 dages sliding expiry. Brugerprofilen
caches lokalt, så app'en åbner direkte i logget-ind-tilstand uden net. Et 401 fra sync sætter en
`needsReauth`-flag der viser et diskret banner — men **blokerer ikke** læsning eller skrivning lokalt.

---

## Login og invite-keys

Better Auth med email+kodeord, Drizzle-adapter, `admin()`-plugin til `role`-feltet.

Selvregistrering gates af en invite-key gennem et lille **Better Auth-plugin** med en `before`-hook på
`/sign-up/email`:

1. Hooken læser `inviteKey` fra request-body, slår `sha256(key)` op i `invite_key`, og afviser med
   422 hvis den ikke findes, er udløbet, tilbagekaldt eller opbrugt.
2. `databaseHooks.user.create.after` tæller `uses` op og logger `used_by_user_id`.
3. Første bruger i en tom database bliver automatisk `admin` — **uden** hardkodet standardkodeord
   (det er præcis den P0-fejl indkob har). Er der ingen brugere, serverer `/opret` en
   førstegangs-opsætningsside uden krav om key; så snart der findes én bruger, kræves key altid.

Admin-siden kan generere keys (nøglen vises én gang, format `xxxx-xxxx-xxxx` fra nanoid med
flagdags forvekslingsfrie alfabet fra `src/lib/public-code.js`), tilbagekalde dem, og se hvem der
har brugt hvad.

Rate limiting på login: Better Auths indbyggede rate limiter slået til, med SQLite-storage så den
overlever genstart.

Cookies: `httpOnly`, `sameSite: "lax"`, `secure` i produktion. Da nginx i containeren kører HTTP og
TLS termineres i nginxproxymanager, skal `trustedOrigins` sættes eksplicit og `X-Forwarded-Proto`
respekteres — ellers sættes `secure`-cookien aldrig.

---

## BoardGameGeek

`GET /api/games/search?q=` proxyer BGG's XML API2 fra serveren (undgår CORS og skjuler din
brugers IP), parser med `fast-xml-parser`, og cacher svaret i `bgg_cache` i 24 timer.
`POST /api/games/import` henter detaljer for ét BGG-id, downloader thumbnail til
`/var/lib/spil/uploads/games/` og opretter en lokal `game`-række. Efter import afhænger app'en
aldrig af BGG igen — vigtigt for offline. BGG er langsom og rate-limiter aggressivt, så
søgning debounces og fejl degraderes til "opret manuelt".

---

## PWA

- `vite-plugin-pwa` i `generateSW`-mode: precache af hele app-shellen, `navigateFallback: /index.html`.
- **Ingen runtime-caching af `/api`** — data kommer fra IndexedDB, ikke fra service worker-cachen.
  Det er den fælde indkob undgik ved slet ikke at have `dataGroups`; her er det et bevidst valg.
- `CacheFirst` på `/uploads/**` så spil-covers og fotos virker offline.
- `registerType: "prompt"` med et "Ny version klar — genindlæs"-banner, så en opdatering ikke
  smider en igangværende registrering væk.
- Manifest: `display: "standalone"`, dansk `name`/`short_name`, maskable ikoner i 192/512.
- nginx sætter `Cache-Control: no-cache` på `sw.js`, `manifest.webmanifest` og `version.json`
  (samme trick som `deploy/nginx-indkob.conf`).

---

## Hosting

Ny LXC på Proxmox-clusteret "Asgard", modelleret efter CT 110/120: unprivilegeret Debian, 0.5 GB RAM
(1 GB da Node bruger mere end .NET her), 8 GB rootfs på NFS `proxmox-data`, HA-registreret.
Foreslået **CT 130 "spil"**. Node 22 installeres i containeren fra NodeSource — vi bruger ikke SEA,
fordi `better-sqlite3` er en native modul.

| Ting | Værdi |
|---|---|
| Web (nginx) | `:80`, root `/var/www/spil` → symlink til `/opt/spil/current/www` |
| API | `127.0.0.1:5060`, proxyet på `/api` |
| SQLite | `/var/lib/spil/spil.db` (WAL) — overlever opdateringer |
| Uploads | `/var/lib/spil/uploads`, serveret af nginx på `/uploads` |
| Hemmeligheder | `/etc/spil/spil.env`, mode 0600, `EnvironmentFile=` i unit'en |
| Releases | `/opt/spil/releases/<timestamp>`, `current`-symlink, sidste 5 beholdes |
| Servicebruger | `spil` (systembruger, `/usr/sbin/nologin`) |

Filer der skal skrives, tæt på indkobs originaler:

- `deploy/spil-api.service` — kopi af `deploy/indkob-api.service` med samme hardening
  (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `ReadWritePaths=/var/lib/spil`),
  men `ExecStart=/usr/bin/node /opt/spil/api/index.js` og `EnvironmentFile=/etc/spil/spil.env`
  i stedet for `Environment=`-linjer, så `BETTER_AUTH_SECRET` ikke ligger i en world-readable unit-fil.
- `deploy/nginx-spil.conf` — kopi af `deploy/nginx-indkob.conf` minus SignalR-blokkene, plus
  `location /uploads/` og no-cache på service worker-filerne.
- `deploy/lxc-bootstrap.sh` og `deploy/lxc-update.sh` — næsten uændrede fra indkob; libicu/libssl-delen
  erstattes af NodeSource-installation, og `lxc-update.sh` kører migrations
  (`node /opt/spil/api/migrate.js`) **efter** at have taget en backup og **før** `systemctl restart`.
- `scripts/release.sh` — `npm ci` i roden, `vite build` → `release/www`, `tsc`/esbuild → `release/api`,
  `npm ci --omit=dev` → `release/api/node_modules`, og et `version.json` i `www/` som frontenden viser.
- `.github/workflows/release.yml` — trigger på `v*`-tags, Node 22, tarball til GitHub Release.

**Backup** — det hul indkob selv har flagget som P2. `lxc-update.sh` tager en `VACUUM INTO`-backup
(konsistent på en WAL-database, i modsætning til flagdags `cp`) til `/var/lib/spil/backups/` før
migrations. Derudover en `spil-backup.timer` der kører dagligt og beholder 14 dage. Selve LXC'en
dækkes af PBS (CT 125), men en app-niveau-backup gør rollback efter en dårlig migration triviel.

Adgang udefra går som dine andre apps via nginxproxymanager (CT 104), interne navne via caddy
(CT 123) og DNS via adguard (CT 101) — der skal altså kun laves en proxy-host, ikke TLS i containeren.
Alloy-agenten installeres så loggene lander i Loki som fra dine andre containere.

Deploy-runbooken i `CLAUDE.md` følger indkobs **godkendelsesregel**: find aktiv host-node med `pvesh`
(containeren kan flytte), vis den konkrete kommando, spørg, og kør først efter tydeligt ja.

---

## Rækkefølge

0. **Læg dokumentationen i projektmappen** (`/home/casper/Workspace/spil`), så arbejdet kan samles op
   senere uden denne session. Kun markdown, ingen kode:
   - `PLAN.md` — denne plan.
   - `DESIGN-BRIEF.md` — briefen nedenfor, klar til Claude Design.
   - `CLAUDE.md` — konventioner (dansk UI og danske kommentarer, 2 spaces, ESM, zod-validering,
     `escapeHtml`-disciplin) plus deployment-runbook med godkendelsesreglen fra indkob.
   - `BESLUTNINGER.md` — de fire afklarede valg og begrundelserne, så de ikke skal genbesluttes.
1. **Fundament** — workspace, TypeScript, Drizzle-skema, migrations, `node --test`-harness der booter
   app mod temp-DB.
2. **Auth** — Better Auth + Drizzle-adapter, invite-key-plugin, førstegangs-admin-opsætning,
   admin-side til keys. *Her er det værd at stoppe og verificere før resten bygges ovenpå.*
3. **Domæne-API** — grupper, spillere (konto + gæst), spil, partier. Gruppeadgang ét sted.
4. **Sync** — pull/push, outbox, LWW, `opId`-idempotens. Enhedstestes med Vitest mod en simuleret
   to-klient-situation før UI'et bygges.
5. **Frontend** — Dexie-lag, sync-loop, mobile-first UI: gruppeliste → gruppe → registrer parti →
   historik → statistik (hvem vinder mest, mest spillede spil).
6. **PWA** — manifest, service worker, installerbarhed, offline-test.
7. **BGG** — søgning, import, thumbnail-download.
8. **Fotos** — upload, offline-blob-håndtering, thumbnails.
9. **Deployment** — `deploy/`-scripts, release-workflow, LXC oprettes og bootstrappes.

---

## Verifikation

- **Backend**: `npm test` — `node --test` booter den rigtige Express-app mod en temp-SQLite (flagdags
  `test/integration.test.js`-mønster). Dækker: signup uden key afvises, med brugt/udløbet key afvises,
  gruppeadgang håndhæves på tværs af brugere, sync-push i én transaktion, LWW-konflikt.
- **Sync-motor**: Vitest med to Dexie-instanser mod en in-memory server — offline-redigering på begge,
  sync, forvent konvergens. Det er den mest fejlbehæftede del, så den testes isoleret.
- **Offline end-to-end**: Playwright med `context.setOffline(true)` — opret parti offline, gå online,
  verificér at det dukker op i en anden browser-kontekst. Playwright virker allerede på maskinen
  (`npx playwright install chromium-headless-shell`, jf. flagdags `.claude/skills/verify/SKILL.md`).
- **Mobile-first**: Playwright med iPhone-viewport + Lighthouse PWA-audit (installerbar, offline-start).
- **Deploy**: `bootstrap` i en throwaway-LXC først, tjek at `systemctl is-active spil-api`, at
  `/api/health` svarer, at DB'en ligger i `/var/lib/spil/`, og at en efterfølgende `update` bevarer data.

---

## Design-brief til Claude Design

Designet laves før implementeringen. Nedenstående gives til Claude Design som selvstændig brief:

````
Design en mobile-first webapp til at holde styr på hvilke brætspil man har spillet med sine venner.
Appen hedder "Spil". Al brugervendt tekst skal være på dansk.

## Kontekst
Selvhostet app til en lille lukket kreds (familie/vennegruppe, 5-30 brugere). Man logger ind,
opretter "grupper" af spillere, og registrerer partier: hvilket spil, hvem der var med, hvem der
vandt og i hvilken rækkefølge, hvornår, hvor, hvor længe, plus noter og billeder.

Vigtigt: der registreres IKKE point pr. spiller — kun placeringer (1., 2., 3. …). Uafgjort er
muligt (to spillere på samme placering). Nogle spil er co-op, hvor holdet samlet vinder eller taber.

## Hårde krav
- **Mobile-first.** Telefonen er den primære enhed — folk registrerer et parti mens de sidder ved
  bordet med spillet foran sig. Design 390px bredt først. Ét breakpoint opad ved 720px til tablet/desktop.
- **Offline-first PWA.** Appen virker uden netværk. Data ligger lokalt og synkroniseres i baggrunden.
  Det skal designet afspejle — se "Offline-tilstande" nedenfor.
- **Installerbar** som app på hjemmeskærmen: respekter `env(safe-area-inset-*)`, ingen browser-chrome
  at læne sig op ad.
- Touch-targets minimum 44×44px. Primære handlinger skal kunne nås med tommelfingeren.
- **Ingen eksterne fonte** — appen skal kunne bygges og køre offline. Brug system font stack.
- Lyst og mørkt tema, begge fuldt designet.

## Skærme

**Auth**
1. Log ind — email + kodeord.
2. Opret konto — email, navn, kodeord, **og et invitationsnøgle-felt** (format `xxxx-xxxx-xxxx`).
   Uden en gyldig nøgle kan man ikke oprette sig. Gør det tydeligt hvorfor feltet er der, uden at
   det føles som en fejlmeddelelse.
3. Førstegangsopsætning — første bruger i en tom installation bliver admin og skal ikke bruge nøgle.

**Kerne**
4. **Hjem** — de seneste partier på tværs af alle grupper, som et feed. Stor, altid synlig
   "Registrer parti"-handling.
5. **Grupper** — liste over ens grupper, plus opret ny.
6. **Gruppe** — medlemmer, seneste partier i gruppen, genvej til gruppens statistik.
   Medlemmer er af to slags og skal kunne skelnes visuelt: rigtige brugerkonti, og "gæster" —
   spillere uden konto som man bare har tilføjet ved navn. En gæst kan senere blive koblet til en konto.
7. **Registrer parti** — det vigtigste flow i hele appen. Skal kunne gennemføres på under et minut
   med én hånd. Trin: vælg spil → vælg hvem der var med (fra gruppens medlemmer, plus mulighed for
   at tilføje en gæst på stedet) → sæt placeringer → dato/sted/varighed → noter og foto.
   Design placerings-trinnet omhyggeligt: at rangere 3-6 personer på en telefon er den svære del.
   Overvej træk-og-slip-sortering kontra tryk-for-at-vælge-vinder. Vis også co-op-varianten
   (hele holdet vandt / tabte).
8. **Parti-detalje** — resultatet, deltagerne, noter, billeder. Kan redigeres og slettes.
9. **Spil-bibliotek** — de spil man har registreret. Man kan søge et spil op i BoardGameGeek og
   importere titel, årstal, cover og spillerantal — eller oprette et spil helt manuelt hvis det
   ikke findes. Søgningen kan være langsom og kan fejle; design ventetilstand og fallback.
10. **Statistik** — hvem vinder mest, mest spillede spil, vinderrækker, antal partier over tid.
    Hold det legende og letlæseligt, ikke et dashboard.
11. **Admin: invitationsnøgler** — kun for admins. Opret nøgle (vises kun én gang — det skal være
    meget tydeligt), tilbagekald nøgle, se hvem der har brugt hvilken.
12. **Profil / indstillinger** — navn, kodeord, tema, log ud, synkroniseringsstatus.

## Offline-tilstande — design disse eksplicit
- Diskret banner når enheden er offline. Appen skal stadig føles fuldt brugbar, ikke "i stykker".
- Et parti der er oprettet offline og endnu ikke synkroniseret: en rolig markering på kortet
  ("gemmes når du er online igen"). Ikke en advarsel — det er den normale, forventede tilstand.
- Synkronisering i gang / senest synkroniseret, i indstillinger.
- "Ny version klar — genindlæs" som et banner man selv trykker på, aldrig et automatisk tab af arbejde.
- Sessionen er udløbet: banner om at logge ind igen, men lokal data er stadig synlig og redigerbar.
- Tomme tilstande for alle lister: ingen grupper, ingen partier, intet spil-bibliotek.

## Tone og udtryk
Det er en hyggelig, privat app om spilaftener med venner — ikke et produktivitetsværktøj og ikke
et sports-statistik-site. Varm, legende og let, men stadig ryddelig og hurtig at scanne.
Brætspils-covers er det eneste rigtige billedmateriale i appen, så lad dem bære farven, og hold
resten af paletten rolig. Undgå at det ligner en generisk SaaS-dashboard-skabelon.

## Leverancer
- High-fidelity skærme for alle ovenstående, i mobil-bredde, i både lyst og mørkt tema.
- 720px+ layout for de skærme hvor det ændrer noget væsentligt.
- Et komponent-inventar: kort, knapper, felter, spiller-chip, placerings-række, banner, tom tilstand,
  bund-navigation, dialog.
- Design tokens som CSS custom properties — farver, mellemrum, radius, typografi-skala, skygger —
  klar til at blive skrevet direkte ind i en håndskrevet stylesheet. Ingen komponentbibliotek,
  ingen Tailwind.
````

---

## To ting fundet undervejs, ikke relateret til denne opgave

- `/home/casper/Workspace/server/ha.txt` indeholder et Home Assistant long-lived token i klartekst.
- `/home/casper/Workspace/server/.claude/settings.local.json` har en Grafana API-nøgle (`glsa_…`)
  indlejret i en allowlisted kommando.

Begge ligger i et git-repo. Værd at rotere og flytte ud i noget, der ikke committes.
