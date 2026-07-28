import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSearch, parseThing } from "../src/bgg-parse.js";

// Faste fixtures i stedet for rigtige kald: BGG er langsomt, rate-limiter og er
// ikke altid oppe. Det der kan gå i stykker hos os er parsningen, ikke deres API.

const SEARCH_XML = `<?xml version="1.0" encoding="utf-8"?>
<items total="2">
  <item type="boardgame" id="266192">
    <name type="primary" value="Wingspan"/>
    <yearpublished value="2019"/>
  </item>
  <item type="boardgame" id="290448">
    <name type="primary" value="Wingspan: European Expansion"/>
    <yearpublished value="2019"/>
  </item>
</items>`;

const SINGLE_HIT_XML = `<?xml version="1.0" encoding="utf-8"?>
<items total="1">
  <item type="boardgame" id="13">
    <name type="primary" value="Catan"/>
    <yearpublished value="1995"/>
  </item>
</items>`;

const THING_XML = `<?xml version="1.0" encoding="utf-8"?>
<items>
  <item type="boardgame" id="266192">
    <thumbnail>https://cf.geekdo-images.com/example_t.jpg</thumbnail>
    <name type="alternate" sortindex="1" value="Flügelschlag"/>
    <name type="primary" sortindex="1" value="Wingspan"/>
    <yearpublished value="2019"/>
    <minplayers value="1"/>
    <maxplayers value="5"/>
  </item>
</items>`;

/** Bygger et thing-svar med de opgivne links. Id og navn er ligegyldige her. */
const thingWithLinks = (links: [type: string, id: number, value: string][]) =>
  `<?xml version="1.0" encoding="utf-8"?>
<items>
  <item type="boardgame" id="1">
    <name type="primary" value="Et spil"/>
    ${links
      .map(([type, id, value]) => `<link type="${type}" id="${id}" value="${value}"/>`)
      .join("\n    ")}
  </item>
</items>`;

const COOPERATIVE = ["boardgamemechanic", 2023, "Cooperative Game"] as const;
const TEAM_BASED = ["boardgamemechanic", 2019, "Team-Based Game"] as const;
const SOLO = ["boardgamemechanic", 2819, "Solo / Solitaire Game"] as const;
const END_GAME_BONUSES = ["boardgamemechanic", 2875, "End Game Bonuses"] as const;
const DICE_ROLLING = ["boardgamemechanic", 2072, "Dice Rolling"] as const;

const outcomeOf = (links: readonly (readonly [string, number, string])[]) =>
  parseThing(thingWithLinks(links as [string, number, string][]))?.defaultOutcomeType;

describe("BoardGameGeek-parsning", () => {
  it("læser søgeresultater", () => {
    assert.deepEqual(parseSearch(SEARCH_XML), [
      { bggId: 266192, title: "Wingspan", year: 2019 },
      { bggId: 290448, title: "Wingspan: European Expansion", year: 2019 },
    ]);
  });

  it("håndterer et enkelt resultat, hvor XML'en ikke er en liste", () => {
    // fast-xml-parser giver et objekt frem for et array ved præcis ét element.
    // Det er den klassiske fælde ved XML, og den skal være dækket.
    assert.deepEqual(parseSearch(SINGLE_HIT_XML), [
      { bggId: 13, title: "Catan", year: 1995 },
    ]);
  });

  it("giver en tom liste når der ingen træffere er", () => {
    assert.deepEqual(parseSearch('<?xml version="1.0"?><items total="0"></items>'), []);
  });

  it("vælger det primære navn, ikke det tyske", () => {
    const details = parseThing(THING_XML);
    assert.equal(details?.title, "Wingspan");
    assert.equal(details?.bggId, 266192);
    assert.equal(details?.year, 2019);
    assert.equal(details?.minPlayers, 1);
    assert.equal(details?.maxPlayers, 5);
    assert.equal(details?.thumbnailUrl, "https://cf.geekdo-images.com/example_t.jpg");
  });

  it("returnerer null når emnet ikke findes", () => {
    assert.equal(parseThing('<?xml version="1.0"?><items></items>'), null);
  });
});

describe("udfaldstype gættet ud fra BGG's mekanikker", () => {
  it("gætter samarbejde", () => {
    // 5-Minute Dungeon: Cooperative Game og ellers ingen point.
    assert.equal(outcomeOf([COOPERATIVE, DICE_ROLLING]), "coop");
  });

  it("gætter hold", () => {
    // Codenames: Team-Based Game.
    assert.equal(outcomeOf([TEAM_BASED]), "teams");
  });

  it("gætter point", () => {
    // Azul, Ticket to Ride, Wingspan: alle har End Game Bonuses.
    assert.equal(outcomeOf([END_GAME_BONUSES, DICE_ROLLING]), "score");
  });

  it("gætter ikke når intet peger nogen vegne", () => {
    // Null, ikke "ranking": klienten falder selv tilbage på placeringer, og
    // null betyder "ikke gættet", så et senere rigtigt parti kan overskrive.
    assert.equal(outcomeOf([DICE_ROLLING]), null);
  });

  it("lader samarbejde slå point", () => {
    // Pandemic har Set Collection ved siden af Cooperative Game. Vinder man
    // sammen, er point ligegyldige.
    assert.equal(
      outcomeOf([["boardgamemechanic", 2004, "Set Collection"], COOPERATIVE]),
      "coop",
    );
  });

  it("bruger ikke solo-mekanikken", () => {
    // Den vigtigste af dem alle. "Solo / Solitaire Game" betyder at spillet
    // *har* en soloversion — den sidder på Wingspan, Pandemic og Gloomhaven.
    // Brugte vi den, ville næsten alle nyere spil defaulte til solo.
    assert.equal(outcomeOf([SOLO, END_GAME_BONUSES]), "score");
    assert.equal(outcomeOf([SOLO, COOPERATIVE]), "coop");
    assert.equal(outcomeOf([SOLO]), null);
  });

  it("ignorerer links der ikke er mekanikker", () => {
    // Kategorien "Party Game" har id 1030 — tæt på mekanik-id'ernes interval,
    // og uden typetjekket ville den kunne ramme et af dem ved et tilfælde.
    assert.equal(outcomeOf([["boardgamecategory", 2023, "Noget"]]), null);
  });
});
