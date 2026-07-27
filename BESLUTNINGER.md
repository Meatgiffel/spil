# Beslutninger

Truffet 2026-07-27 under planlægningen. Formålet med filen er at de ikke skal genbesluttes.
Ændrer du en beslutning, så ret den her og skriv hvorfor — ikke bare i koden.

---

## Produktbeslutninger (afklaret med Casper)

### Offline: fuld offline med sync

IndexedDB er sandheden på klienten. Man kan oprette, redigere og slette partier, grupper og spillere
helt uden net; ændringer køes i en outbox og synkroniseres når forbindelsen er tilbage.

*Fravalgt:* "offline læsning + kø af skrivninger" og "kun app-shell offline". Begrundelsen for det
dyre valg er brugssituationen — man sidder ved spillebordet, ofte et sted med dårligt netværk, og
registrerer et parti. Hvis app'en tøver eller fejler dér, bliver den ikke brugt.

*Konsekvens:* der skal skrives en sync-motor med konfliktløsning. Det er projektets største risiko
og bygges derfor tidligt og testes isoleret.

### Spil-titler: manuel oprettelse + BoardGameGeek-opslag

BGG bruges til at slå titel, årstal, cover og spillerantal op. Efter import er data lokalt, og
app'en afhænger aldrig af BGG igen. Manuel oprettelse er altid mulig — BGG er langsom, rate-limiter
aggressivt og mangler nogle titler.

### Parti-data: fem udfaldstyper

*Udvidet 2026-07-27. Oprindeligt kun placeringer og co-op; point var bevidst fravalgt.*

Et parti har en `outcomeType`, og den afgør både registreringen og hvem der har vundet:

| Type | Afgøres af | Eksempler |
|---|---|---|
| `ranking` | Placeringer, uafgjort tilladt | Ticket to Ride, Carcassonne |
| `score` | Point. Placeringer regnes ud automatisk | Wingspan, 6 nimmt! |
| `coop` | Holdet vinder eller taber samlet | Pandemic, 5 Minute Dungeon |
| `teams` | Hold mod hold — dækker også forrædere og én-mod-alle | Codenames, Secret Hitler, Scotland Yard |
| `solo` | Ét menneske mod spillet | Spirit Island solo |

Dertil et `abandoned`-flag, som er **uafhængigt** af typen: et parti kan afbrydes uanset hvordan
det ellers ville være afgjort, og så er der ingen vinder. Havde afbrudt været en sjette type,
kunne man ikke registrere et afbrudt holdspil som holdspil.

Typen **huskes pr. spil** (`game.default_outcome_type`), så man vælger den én gang. Det samme
gælder `low_score_wins` for spil hvor færrest point vinder.

Til samarbejds- og solospil er der tre valgfrie felter til *hvor langt I nåede*: `milestone`
(fritekst — "Boss 4", "Mission 23"), `time_remaining_seconds` og `difficulty`. Fritekst frem for
en talværdi, fordi hvert spil har sit eget begreb for hvor langt man er nået.

Fravalgt: felter defineret pr. spil. Det ville give pænere statistik, men kræver en editor til
feltdefinitioner og gør den første registrering af hvert spil omstændelig.

**Vinderreglen findes ét sted**, `client/src/outcome.ts`. Den bruges af feed, partidetalje og
statistik — ligger den tre steder, begynder de tre at være uenige.

Kampagne og legacy (Gloomhaven, Pandemic Legacy) er stadig ikke dækket. Det kræver en
kampagne-enhed med sin egen historik og er et projekt for sig.

### Auth: Better Auth

Email + kodeord, sessions i SQLite, `admin()`-plugin til roller. Valgt frem for et hjemmestrikket
session-lag (mere kode at vedligeholde selv) og Passport.js (gammeldags API, svag TypeScript-støtte).
Better Auth giver desuden passkeys senere uden omskrivning.

---

## Tekniske beslutninger

### Deployment: indkobs mønster, ikke flagdags

Tag → GitHub Actions bygger tarball → `lxc-update.sh` henter latest release og laver atomisk
symlink-swap. nginx serverer SPA'en og reverse-proxyer en localhost-bundet API.

*Hvorfor:* den nye service har præcis samme form som indkob (SPA + API + SQLite + PWA), og indkob
har deploy-scripts, systemd-unit og nginx-vhost versioneret i repoet. Flagdag har ingen
deploy-artefakter overhovedet — alt står kun i prosa i dens `CLAUDE.md`, og opdatering er
`git pull` i containeren, hvilket kræver toolchain og en ren arbejdskopi på serveren.

*Fra flagdag tages derimod konventionerne:* dansk UI og danske kommentarer, zod-validering,
`node --test`-integrationstest der booter den rigtige app mod en temp-DB, og strukturen hvor
app'en eksporterer `app` og kun lytter ved direkte kørsel.

### Drizzle, ikke Prisma

Flagdag bruger Prisma til klient-generering, mens skemaet i virkeligheden laves af rå SQL i
`scripts/setup-db.js` — to kilder til sandhed, som deres egen `CLAUDE.md` advarer om. Drizzle giver
ét skema (`server/src/db/schema.ts`), rigtige migrations via drizzle-kit, og har en officiel
Better Auth-adapter.

### better-sqlite3, ikke node:sqlite

`node:sqlite` er stadig eksperimentel på Node 22. `better-sqlite3` er synkron, understøtter WAL og
har prebuilt binaries til linux-x64.

*Konsekvens:* native modul, så vi kan ikke bruge Node SEA — Node 22 installeres i containeren fra
NodeSource.

### Håndskrevet sync-motor

Ingen færdig løsning passer: ElectricSQL og PowerSync kræver Postgres, Triplit vil have sin egen
server. Til en SQLite-app i en LXC er ~300 linjer egen kode det rigtige valg.

Konfliktløsning er last-write-wins på rækkeniveau afgjort på `updated_at` med `id` som tiebreak.
Det er tilstrækkeligt her, fordi to personer sjældent redigerer samme parti samtidigt, og fordi
`play_participant` er splittet ud i egne rækker — så to personer der retter hver sin placering
ikke overskriver hinanden.

### Sync-cursor er en serversekvens, ikke et tidsstempel

*Ændret 2026-07-27 under implementeringen. Planen sagde oprindeligt at cursoren var servertid.*

Hver synkroniseret tabel har **to** kolonner der ligner hinanden, og de må ikke slås sammen:

- `updated_at` — klientens tidsstempel. Bruges kun til last-write-wins.
- `server_seq` — serverens monotone sekvens. Bruges kun som sync-cursor.

Med kun ét felt går offline-ændringer tabt: en rettelse lavet i går har et `updated_at` i går, og
en klient der allerede har synkroniseret forbi det tidspunkt henter den aldrig. Det blev fanget af
testen "propagerer sletning som soft delete", som fejlede præcis sådan.

`server_seq` er **bevidst uden default-værdi** i skemaet. En række med `server_seq = 0` ville aldrig
blive hentet af nogen klient, og uden default bliver det en compile-fejl at glemme den. Enhver
serverside-skrivning til en synkroniseret tabel skal kalde `allocateServerSeq()` — det gælder også
skrivninger uden om sync-stien, som spilleren der oprettes ved signup.

### Domæne-API'et er sync-endpointet

Planen havde "domæne-API" og "sync" som to trin. I praksis falder de sammen: når klienten er
offline-first, går **alle** domæneskrivninger gennem `POST /api/sync/push`, og alle læsninger
kommer fra IndexedDB fyldt af `POST /api/sync/pull`. Der er derfor ingen separate CRUD-ruter for
grupper, spillere, spil og partier — det ville være en anden vej til de samme data med sit eget
adgangstjek at holde synkront.

Det der blev tilbage af "domæne-API" er `server/src/access.ts` med `assertGroupAccess()`, plus de
per-tabel skriveregler i `server/src/sync.ts`. Egne ruter findes kun til det der ikke kan udtrykkes
som en synkroniseret række: invitationsnøgler, BGG-opslag og filupload.

### Ingen service worker-caching af `/api`

Data kommer fra IndexedDB, ikke fra Workbox-cachen. To lag der cacher det samme giver kun
forvirring om hvad der er nyest.

### Fejl fra indkob der ikke gentages

Begge står som P0 i indkobs eget `docs/hardening-plan.md`:

- **Ingen hardkodet bootstrap-bruger.** Indkob seeder `admin`/`changeme` og logger kodeordet i
  klartekst ved opstart. Her bliver første bruger i en tom database admin gennem en
  førstegangs-opsætningsside, uden standardkodeord.
- **Ingen `AllowAnyOrigin`-fallback på CORS.** Mangler konfigurationen i produktion, skal opstart
  fejle — ikke falde tilbage til at tillade alt.

Og fra flagdag: backup tages med `VACUUM INTO`, ikke `cp` af databasefilen. `cp` på en WAL-database
under skrivning kan give en inkonsistent kopi.

---

### BoardGameGeek kræver nu et token

*Opdaget 2026-07-27, efter at appen var deployet.*

BGG lukkede XML API'et bag registrering og bearer-tokens i efteråret 2025. Både v1 og v2 svarer
401 uden `Authorization: Bearer <token>`. Planen gik ud fra et åbent API — det holder ikke længere.

Tokenet er gjort **valgfrit** (`BGG_TOKEN`). Er det ikke sat, skjuler søgefeltet sig selv, og spil
oprettes manuelt. Et opslagsværktøj må ikke kunne gøre resten af biblioteket ubrugeligt.

Manglende eller afvist token giver **501**, ikke 503. 503 betyder "prøv igen om lidt", og det ville
sende brugeren i den forkerte retning: ingen ventetid løser et manglende token. Ved 401/403 fra BGG
sendes deres egen svartekst med, så man kan se forskel på udløbet, forkert og uregistreret token.

Cachen bruges også når tokenet mangler, så allerede hentede søgninger stadig virker.

### To sprog, engelsk som standard

*Tilføjet 2026-07-27. App'en var oprindeligt kun dansk.*

Håndskrevet i18n frem for et bibliotek: ordbogen er ét objekt, `en` er kilden, og
`da` er typet som `Record<MessageKey, string>`. Glemmer man en nøgle, fejler
bygningen — det er den samme garanti et bibliotek ville give, uden afhængigheden
og uden endnu et lag der skal kunne køre offline.

**Sproget ligger i localStorage, ikke i IndexedDB.** To grunde. localStorage er
synkront, så sproget er kendt allerede ved første render; med Dexie var der et
glimt af engelsk, og et genindlæs lige efter et valg kunne nå at afbryde
skrivningen — det blev fanget af e2e-testen. Og sproget hører til *enheden*, ikke
kontoen: det skal overleve et log ud, hvor al lokal data ryddes.

**Serverens fejl blev til koder.** `HttpError` bærer en `ErrorCode`, og
zod-beskederne er koder frem for sætninger. Klienten oversætter og falder
tilbage på serverens tekst for ukendte koder — det sker fx når serveren er nyere
end den app der ligger i browserens cache. Alternativet, at serveren læser
`Accept-Language`, ville sprede oversættelser ud over to kodebaser.

### Fotos går uden om outboxen

En `photo`-række skal have en rigtig serversti i `file_path`, og den findes først efter uploaden.
Billeder taget offline lægges derfor i en separat `blobs`-tabel i IndexedDB og vises derfra;
`photo`-rækken oprettes først når filen er kommet frem. Brugeren kan ikke se forskel.

Alternativet — at lade outboxen bære selve filen — ville betyde binære data i sync-protokollen og
en 12 MB payload i en batch der ellers er ren JSON.

### Første synkronisering venter

Ens egen spiller-række oprettes på serveren ved signup og kommer først med i en pull. Login venter
derfor på én synkronisering før app'en lukkes op ("Henter dine data…"). Uden det kunne man nå at gå
offline før rækken var hentet og stod så i sin egen gruppe uden at kunne vælge sig selv som
deltager. Offline-first begynder efter den ene synkronisering.

### Sync-loopet stoler ikke på `online`-eventet

Loopet prøver igen efter 5 sekunder når der er noget i kø eller sidste forsøg fejlede, og ellers
hvert minut. `online`-eventet bruges som en hurtig vej ind, men er ikke alene om det: det fyres
ikke bag captive portals, ikke altid ved skift mellem mobilnet og wifi, og slet ikke under
Playwrights offline-emulering. Var det eneste trigger, kunne en kø blive stående for evigt.

### Ingen Google Fonts

Claude Design-systemet "Modernist" importerer Archivo fra Google Fonts i sin `styles.css`. Det er
droppet — appen skal kunne bygges og køre offline, og en blokerende ekstern font ville også være
det første der fejlede i en LXC uden udgående adgang. Systemets font-stack bruges i stedet, præcis
som designets egne skærme gør.

## Åbne punkter

- CT-nummer og host-node til den nye LXC er ikke besluttet endeligt. `CT 130 "spil"` er forslaget;
  `balder` (192.168.50.228) har mest RAM.
- Domænenavn / proxy-host i nginxproxymanager er ikke valgt.
- Om gæstespillere skal kunne "kræves" af en ny bruger ved oprettelse (koble sin konto til en
  eksisterende gæst) — datamodellen understøtter det, men flowet er ikke designet.
