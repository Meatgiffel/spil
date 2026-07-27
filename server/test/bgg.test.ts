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
