# Spil

Selvhostet app til at holde styr på hvilke brætspil man har spillet med sine venner.
Offline-first PWA — den virker ved spillebordet uden net og synkroniserer bagefter.

## Hvad den kan

- **Grupper** af spillere. Medlemmerne kan både være rigtige konti og **gæster uden konto**,
  så man ikke skal tvinge alle til at oprette sig for at kunne registrere et parti.
- **Partier** med vinder og placeringer, uafgjort, og co-op hvor holdet samlet vinder eller taber.
  Dertil dato, sted, varighed, noter og billeder.
- **Spilbibliotek** med opslag i BoardGameGeek. Titel, årstal, spillerantal og cover hentes ned
  lokalt, så biblioteket også virker offline. Man kan altid oprette et spil manuelt.
- **Statistik** pr. gruppe: hvem vinder mest, og hvad der bliver spillet oftest.
- **Login med invitationsnøgle.** Man kan oprette sig selv, men kun med en nøgle udstedt af en
  administrator. Første konto i en tom installation bliver administrator uden nøgle.
- **Offline hele vejen.** Alt ligger i IndexedDB. Man kan oprette, rette og slette uden net;
  ændringerne køes og sendes når forbindelsen er tilbage.

Al brugervendt tekst er på dansk.

## Kom i gang

```bash
npm install
npm run db:migrate

export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
export DATABASE_PATH=./dev.db
export UPLOADS_DIR=./uploads
export PUBLIC_URL=http://localhost:5173
export TRUSTED_ORIGINS=http://localhost:5173

npm run dev
```

Åbn <http://localhost:5173>. Første gang viser den en opsætningsside — den konto du opretter der
bliver administrator og kan udstede invitationsnøgler under **Profil → Invitationsnøgler**.

## Test

```bash
npm test         # backend (node --test) + klientens sync-motor (vitest)
npm run test:e2e # Playwright: opret et parti offline, gå online, se det på en anden enhed
```

## Opbygning

| Mappe | Indhold |
|---|---|
| `shared/` | zod-skemaer og typer delt mellem klient og server, inkl. sync-protokollen |
| `server/` | Express 5, Drizzle ORM, SQLite, Better Auth |
| `client/` | React 19, Vite, Dexie (IndexedDB), service worker |

Klienten skriver aldrig direkte til serveren. Alt går gennem to endpoints — `POST /api/sync/push`
og `POST /api/sync/pull` — med en outbox på klienten og last-write-wins ved konflikter.
Se `BESLUTNINGER.md` for hvorfor det er skruet sådan sammen, og `PLAN.md` for helheden.

## Status

Appen er bygget og testet lokalt. **Deployment mangler** — `deploy/`-scripts, release-workflow og
selve LXC'en er ikke lavet endnu. `PLAN.md` beskriver hvordan det skal gøres.
