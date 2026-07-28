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

*Bekræftet 2026-07-28 mod et rigtigt token: `Authorization: Bearer <token>` er det rigtige format.
Uden header svarer BGG 401, med den 200. Formatet var indtil da gættet ud fra deres forum.*

---

### Udfaldstypen gættes ud fra BGG's mekanikker

*Tilføjet 2026-07-28.*

BGG har ikke noget felt der siger hvordan et spil vindes. Det tætteste er `boardgamemechanic`-links,
og tre af dem er brugbare: **Cooperative Game** (2023) → `coop`, **Team-Based Game** (2019) → `teams`,
og en kort liste point-mekanikker (End Game Bonuses, Hidden Victory Points, Area Majority,
Set Collection) → `score`. Rammer intet, sættes typen til `null`, og klienten falder selv tilbage
på placeringer.

Rækkefølgen er prioriteten, og samarbejde kommer først: Pandemic har både Set Collection og
Cooperative Game, og vinder man sammen, er point ligegyldige.

**Mekanik-id'er, ikke navne.** BGG omdøber løbende sine mekanikker — "Area Control" hedder nu
"Area Majority / Influence" — mens id'et står fast.

**Solo-mekanikken bruges bevidst ikke.** 2819 "Solo / Solitaire Game" betyder *"har en soloversion"*,
ikke *"er et solospil"*. Den sidder på Wingspan, Pandemic og Gloomhaven. Brugte vi den, ville
næsten alle nyere spil defaulte til solo. `solo` må brugeren vælge selv. Der er en test der
holder på det.

Gættet er kun et **udgangspunkt**. Har spillet allerede en `default_outcome_type`, er den lært af
et rigtigt parti og slår BGG — importen overskriver den aldrig.

Verificeret mod 12 rigtige BGG-svar: Catan, Pandemic, Codenames, Mansions of Madness, Gloomhaven,
Wingspan, 5-Minute Dungeon, Ticket to Ride, Azul, Carcassonne, The Mind og Scrabble ramte alle
den rigtige type.

`low_score_wins` gættes **ikke**. BGG har intet signal for om færrest point vinder, og et forkert
gæt her vender vinderen på hovedet — modsat udfaldstypen, hvor et forkert gæt bare er et forkert
udgangspunkt.

---

### BGG-søgningen ligger i registreringsflowet, ikke kun i biblioteket

*Ændret 2026-07-28.*

Oprindeligt søgte feltet på "Hvilket spil?" kun i det lokale bibliotek, og BGG-søgningen lå på
spilskærmen. Det var en fejl i praksis: man står med spillet foran sig, skriver titlen, og får
ingenting — uden at der er noget der antyder at man skal et andet sted hen først.

Nu søger det samme felt begge steder. **Lokale træffere vises først og virker offline**; BGG-delen
kommer under, i sit eget afsnit, og forsvinder helt uden net eller token. Rækkefølgen er ikke
kosmetik — den holder registreringsflowet brugbart offline, hvilket var hele grunden til at holde
netværket ude af det til at begynde med.

Spil man allerede har, filtreres ud af BGG-listen. Ellers ville det samme spil stå to gange, og den
ene af dem ville kræve forbindelse.

Importen venter på synkroniseringen, før spillet vælges. Uden ventetiden kunne man vælge et spil der
endnu ikke fandtes i Dexie, og næste trin ville stå uden udfaldstype.

**Covers hentes hjem på serveren**, også for søgeresultater der aldrig bliver importeret. Klienten
henter aldrig billeder fra geekdo — samme grund til at API'et proxyes: biblioteket skal virke
offline, og brugerens IP skal ikke sendes videre. Filnavnet er bgg-id'et, så et cover kun hentes
én gang, og importen bagefter er gratis.

BGG's søgesvar indeholder hverken cover eller spillerantal, så det kræver et ekstra `thing`-opslag.
Det samles til **ét kald** for alle træffere, og id'erne sorteres, så to søgninger med de samme
træffere i forskellig rækkefølge rammer den samme cache-nøgle. Fejler opslaget, returneres titlerne
alligevel — et manglende cover må ikke koste søgeresultatet.

---

### Et nyt medlemskab stempler spillerrækkens `server_seq` om

*Fejl fundet 2026-07-28 af en browsertest af kontosøgningen.*

Tilføjede man en konto til en gruppe, dukkede personen **aldrig** op i medlemslisten.

Årsagen sidder i sync-protokollen. En spiller er synlig for dem man deler gruppe med, og opslaget
går gennem `group_member`. Medlemskabet får et nyt `server_seq` når det skrives — men spillerrækken
beholder det den fik da kontoen blev oprettet, typisk langt under de andres cursor. Pull henter kun
rækker over cursoren, så spilleren blev aldrig hentet, selv om vedkommende nu var synlig.

Rettelsen: `groupMember.upsert` stempler den refererede spillers `server_seq` om med samme sekvens
som medlemskabet. **Kun `server_seq`** — `updated_at` er klientens tid og afgør konflikter, og at
skrue på den ville lade serveren vinde en konflikt den ikke har været part i.

Koblingen af gæst til konto havde allerede den her rettelse indbygget, med en kommentar om hvorfor.
Den samme indsigt manglede bare på vejen gennem sync.

Det er den femte fejl testene har fundet som ikke kunne ses i koden — og den eneste af dem der
krævede *to* konti for at vise sig. Derfor opretter e2e-testen nu en ekstra konto gennem API'et.

---

### Kontovælgeren søger, den lister ikke

*Ændret 2026-07-28.*

Både "Tilføj medlem" og "Kobl til konto" viste alle konti som en liste. Nu søger man i stedet, på
**både navn og e-mail** — navnet alene skelner ikke to personer der hedder det samme, og e-mailen
står derfor også under navnet.

Filtreringen sker lokalt. Listen er allerede hentet, installationen er lukket bag invitationsnøgler,
og et kald pr. tastetryk ville kun gøre den langsommere.

De to steder deler én komponent, men har hver sin tomme tilstand: ved kobling betyder tom "der er
ingen andre konti", ved medlem betyder den "alle med en konto er allerede med". Samme tekst til
begge ville være forkert det ene sted.

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

### Gæst → konto er en sammenlægning, ikke et felt

*Tilføjet 2026-07-27. Stod tidligere som et åbent punkt.*

Hver konto får sin egen spiller ved oprettelse, og der er et unikt indeks på `user_id`. Koblingen
kan derfor ikke være "sæt `user_id` på gæsten" — det ville give kontoen to spillere. Den er en
sammenlægning: gæstens partier og medlemskaber flyttes over på kontoens spiller, og gæsten
soft-slettes.

**Går bevidst uden om sync.** Den kræver begge spilleres fulde historik og skal være atomisk, og
ingen af delene kan lade sig gøre på en offline klient. Derfor `POST /api/players/:id/link`.

To detaljer der ikke er valgfrie:

- **Gæstens medlemskab soft-slettes; kontoen får en ny række.** Flyttede man rækken i stedet, ville
  intet længere pege på gæsten — og da pull viser en spiller til dem der deler gruppe med
  vedkommende *via* `group_member`, ville sletningen af gæsten aldrig nå ud. Klienterne ville
  beholde en død spiller for evigt. Det blev fanget af testen "flytter gæstens partier og
  medlemskab over på kontoen".
- **Var begge med i samme parti**, beholdes kontoens deltagerrække og gæstens soft-slettes. Det
  unikke indeks på `(play_id, player_id)` tillader ikke to.

Man skal være medlem af **alle** de grupper gæsten er med i. Ellers kunne et medlem af én gruppe
omskrive historik i en anden.

### Kontolisten går uden om sync

`GET /api/players/accounts` viser alle konti. En spiller synkroniseres først når man deler gruppe,
men man skal netop kunne finde nogen man *ikke* deler gruppe med endnu for at tilføje dem — det er
en hønen-og-ægget-situation sync ikke kan løse.

Installationen er lukket bag invitationsnøgler, så navn og e-mail er ikke oplysninger der skal
skjules for dem der allerede er lukket ind.

### Alle medlemmer styrer gruppen

Der er ingen rolleforskel i praksis: ethvert medlem kan tilføje, rette og slette i gruppen.
`group_member.role` findes i skemaet og sættes til `owner` for opretteren, men bruges ikke til
adgangskontrol. Det er et bevidst valg for en app til en vennekreds — ikke en forglemmelse.

## Åbne punkter

- CT-nummer og host-node til den nye LXC er ikke besluttet endeligt. `CT 130 "spil"` er forslaget;
  `balder` (192.168.50.228) har mest RAM.
- Domænenavn / proxy-host i nginxproxymanager er ikke valgt.
- Om `group_member.role` skal bruges til noget, fx at kun ejeren må slette gruppen.
