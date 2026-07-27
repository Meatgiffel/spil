# Design-import fra Claude Design

Designet er lavet i Claude Design ud fra `DESIGN-BRIEF.md`. Denne fil gemmer importinstruktionen,
så den kan køres når implementeringen går i gang.

**Ikke udført endnu.** Designet skal først importeres og gennemgås; derefter oversættes design tokens
til CSS custom properties, og komponenterne bygges som React-komponenter efter planen i `PLAN.md`.

## Instruktion (verbatim, fra Claude Design)

```
Use the claude_design MCP (https://api.anthropic.com/v1/design/mcp, auth via /design-login) to import this project:
https://claude.ai/design/p/dde10e97-8557-44fb-927e-25704fe96f1d?file=Spil.dc.html

Focus on these files (the whole project is readable):
- `Spil.dc.html`

Also read these files the selection imports:
- `support.js`

Implement: `Spil.dc.html`
```

## Detaljer

| | |
|---|---|
| Projekt-URL | https://claude.ai/design/p/dde10e97-8557-44fb-927e-25704fe96f1d |
| Projekt-id | `dde10e97-8557-44fb-927e-25704fe96f1d` |
| Hovedfil | `Spil.dc.html` |
| Understøttende fil | `support.js` |
| MCP-server | `https://api.anthropic.com/v1/design/mcp` |
| Auth | `/design-login` |

## Filer i projektet (verificeret 2026-07-27)

Adgang er bekræftet — projektet kan læses og skrives. Faktisk indhold:

```
Spil.dc.html                          hovedskærmene
Spil - tilstande og layout.dc.html    tilstande og layout
support.js
_ds/modernist-492b90ab-…/styles.css       design tokens
_ds/modernist-492b90ab-…/_ds_bundle.js
_ds/modernist-492b90ab-…/_ds_manifest.json
_ds/modernist-492b90ab-…/readme.md
_ds/modernist-492b90ab-…/_adherence.oxlintrc.json
```

Design systemet hedder "modernist". `styles.css` er kilden til de design tokens, der skal oversættes
til CSS custom properties.

## Før den køres

- **Importinstruktionen nævner kun `Spil.dc.html` og `support.js`.** Der findes også
  `Spil - tilstande og layout.dc.html`, som efter navnet dækker tilstande og layout — herunder
  formentlig offline-tilstandene, der er et hårdt krav i `DESIGN-BRIEF.md`. Tag den med.
- Bemærk at instruktionen siger `Implement:` — den vil generere kode. Importér og læs designet
  først, og hold implementeringen inden for den rækkefølge der står i `PLAN.md`, så designet ikke
  kommer til at diktere en anden arkitektur end den planlagte (håndskrevet CSS, ingen Tailwind,
  ingen eksterne fonte eller CDN-assets).
- Tjek at det importerede design dækker offline-tilstandene fra `DESIGN-BRIEF.md` — de er nemme
  at overse, og de er ikke valgfrie her.
