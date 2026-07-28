import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { bootTestServer, createAccount, type TestServer } from "./helpers.js";

/**
 * Søgningen beriges med cover og spillerantal, som BGG's søgesvar ikke
 * indeholder. Det koster et ekstra opslag, og de her tests holder på at det
 * bliver ét samlet kald — og at søgningen stadig svarer hvis det fejler.
 *
 * BGG stubbes. Kald til vores egen server går videre til den rigtige fetch.
 *
 * Hver test har sit eget søgeord og dermed sine egne id'er. Serveren cacher
 * BGG-svar i et døgn, så to tests der delte id'er ville ramme cachen i stedet
 * for stubben — og den anden af dem ville måle noget helt andet end den tror.
 */

type Fixture = { title: string; year: number; min: number; max: number };

const CATALOG: Record<number, Fixture> = {
  13: { title: "Catan", year: 1995, min: 3, max: 4 },
  207830: { title: "5-Minute Dungeon", year: 2017, min: 2, max: 5 },
  822: { title: "Carcassonne", year: 2000, min: 2, max: 5 },
  230802: { title: "Azul", year: 2017, min: 2, max: 4 },
  9209: { title: "Ticket to Ride", year: 2004, min: 2, max: 5 },
  266192: { title: "Wingspan", year: 2019, min: 1, max: 5 },
  244992: { title: "The Mind", year: 2018, min: 2, max: 4 },
  178900: { title: "Codenames", year: 2015, min: 2, max: 8 },
};

/** Søgeord → de id'er BGG "finder". Holder testene fri af hinandens cache. */
const QUERY_IDS: Record<string, number[]> = {
  berig: [13, 207830],
  batch: [822, 230802],
  token: [9209],
  cover: [266192],
  igen: [244992],
  fejler: [178900],
};

const searchXml = (ids: number[]) => `<?xml version="1.0" encoding="utf-8"?>
<items total="${ids.length}">
  ${ids
    .map(
      (id) =>
        `<item type="boardgame" id="${id}"><name type="primary" value="${CATALOG[id]!.title}"/>` +
        `<yearpublished value="${CATALOG[id]!.year}"/></item>`,
    )
    .join("\n  ")}
</items>`;

const thingsXml = (ids: number[]) => `<?xml version="1.0" encoding="utf-8"?>
<items>
  ${ids
    .map((id) => {
      const row = CATALOG[id]!;
      return (
        `<item type="boardgame" id="${id}">` +
        `<thumbnail>https://cf.geekdo-images.com/${id}.png</thumbnail>` +
        `<name type="primary" value="${row.title}"/>` +
        `<yearpublished value="${row.year}"/>` +
        `<minplayers value="${row.min}"/><maxplayers value="${row.max}"/>` +
        `</item>`
      );
    })
    .join("\n  ")}
</items>`;

// En gyldig, minimal PNG. Indholdet er ligegyldigt — den skal bare skrives ned.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001",
  "hex",
);

type Call = { url: string; auth: string | null };

let server: TestServer;
let calls: Call[] = [];
let detailsFail = false;
const realFetch = globalThis.fetch;

function stubBgg() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (!url.includes("boardgamegeek.com") && !url.includes("geekdo-images.com")) {
      return realFetch(input, init);
    }

    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get("authorization") });

    if (url.includes("geekdo-images.com")) {
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    }

    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/search")) {
      const query = parsed.searchParams.get("query") ?? "";
      return new Response(searchXml(QUERY_IDS[query] ?? []), { status: 200 });
    }

    if (detailsFail) return new Response("BGG er nede", { status: 500 });
    const ids = (parsed.searchParams.get("id") ?? "")
      .split(",")
      .map(Number)
      .filter((id) => id in CATALOG);
    return new Response(thingsXml(ids), { status: 200 });
  }) as typeof fetch;
}

type Result = {
  bggId: number;
  title: string;
  year: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  thumbnailPath: string | null;
};

async function search(cookie: string, q: string): Promise<Result[]> {
  const response = await realFetch(`${server.baseUrl}/api/games/search?q=${q}`, {
    headers: { cookie },
  });
  assert.equal(response.status, 200, await response.clone().text());
  return ((await response.json()) as { results: Result[] }).results;
}

describe("BoardGameGeek-søgning med cover", () => {
  let cookie: string;

  before(async () => {
    // Sættes før serveren bootes: env.ts læser miljøet ved import.
    process.env.BGG_TOKEN = "test-token";
    server = await bootTestServer();
    stubBgg();
    cookie = (await createAccount(server, { email: "anna@example.com", name: "Anna" })).cookie;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    delete process.env.BGG_TOKEN;
    await server.close();
  });

  it("beriger træfferne med cover og spillerantal", async () => {
    const results = await search(cookie, "berig");

    assert.deepEqual(
      results.map((row) => [row.title, row.minPlayers, row.maxPlayers, row.thumbnailPath]),
      [
        ["Catan", 3, 4, "/uploads/games/13.png"],
        ["5-Minute Dungeon", 2, 5, "/uploads/games/207830.png"],
      ],
    );
  });

  it("henter detaljerne i ét kald, ikke ét pr. træffer", async () => {
    calls = [];
    await search(cookie, "batch");

    const thingCalls = calls.filter((call) => call.url.includes("/thing?"));
    assert.equal(thingCalls.length, 1, "to træffere må ikke give to detaljeopslag");
    assert.match(thingCalls[0]!.url, /id=822,230802/, "id'erne skal sorteres og samles");
  });

  it("sender tokenet med til BGG, men ikke til billederne", async () => {
    calls = [];
    await search(cookie, "token");

    const bggCalls = calls.filter((call) => call.url.includes("boardgamegeek.com"));
    assert.ok(bggCalls.length >= 2, "både søgning og detaljer skal være kaldt");
    for (const call of bggCalls) assert.equal(call.auth, "Bearer test-token");

    // Billederne ligger på et andet domæne — tokenet har intet at gøre der.
    for (const call of calls.filter((row) => row.url.includes("geekdo-images.com"))) {
      assert.equal(call.auth, null);
    }
  });

  it("serverer det hentede cover", async () => {
    await search(cookie, "cover");
    const response = await realFetch(`${server.baseUrl}/uploads/games/266192.png`);
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).length, PNG.length);
  });

  it("henter ikke det samme cover to gange", async () => {
    await search(cookie, "igen");
    calls = [];
    // Cachen dækker XML'en; filtjekket dækker billedet. Ingen af delene må
    // ende med at hente det samme igen.
    await search(cookie, "igen");
    assert.deepEqual(calls, []);
  });

  it("svarer stadig med titler når detaljeopslaget fejler", async () => {
    // Et cover er en pyntedetalje. Fejler det, skal man stadig kunne finde og
    // importere spillet — ellers har BGG's ustabilitet lukket hele vejen.
    detailsFail = true;
    try {
      const results = await search(cookie, "fejler");
      assert.deepEqual(
        results.map((row) => [row.title, row.thumbnailPath, row.minPlayers]),
        [["Codenames", null, null]],
      );
    } finally {
      detailsFail = false;
    }
  });
});
