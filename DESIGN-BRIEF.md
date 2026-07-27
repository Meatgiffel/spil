# Design-brief — "Spil"

Denne fil er skrevet til at blive givet direkte til Claude Design (eller en anden designer).
Den er selvstændig: al nødvendig kontekst står nedenfor, så man ikke behøver læse `PLAN.md` først.

Designet laves **før** implementeringen. Når det ligger fast, oversættes design tokens til
CSS custom properties i en håndskrevet stylesheet.

---

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
