import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { bggCache } from "./db/schema.js";
import { env } from "./env.js";
import { parseSearch, parseThing, type BggDetails, type BggSearchHit } from "./bgg-parse.js";

export type { BggDetails, BggSearchHit } from "./bgg-parse.js";
export { parseSearch, parseThing } from "./bgg-parse.js";

const BASE = "https://boardgamegeek.com/xmlapi2";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Fejl der skyldes BGG's adgangskrav frem for et almindeligt nedbrud.
 *
 * De to skal skelnes i UI'et: "prøv igen om lidt" er en misvisende besked, når
 * problemet er at der mangler et token, og ingen ventetid løser det.
 */
export class BggAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BggAuthError";
  }
}

export function bggIsConfigured(): boolean {
  return Boolean(env.BGG_TOKEN);
}

// BGG er langsom og rate-limiter aggressivt, så hvert svar caches et døgn.
// Uden det ville hvert tastetryk i søgefeltet blive et kald.
function cached(key: string): string | null {
  const row = db.select().from(bggCache).where(eq(bggCache.queryHash, key)).get();
  if (!row) return null;
  if (Date.now() - row.fetchedAt > CACHE_TTL_MS) return null;
  return row.payload;
}

function store(key: string, payload: string): void {
  db.insert(bggCache)
    .values({ queryHash: key, payload, fetchedAt: Date.now() })
    .onConflictDoUpdate({
      target: bggCache.queryHash,
      set: { payload, fetchedAt: Date.now() },
    })
    .run();
}

async function fetchXml(url: string): Promise<string> {
  const key = createHash("sha256").update(url).digest("hex");
  const hit = cached(key);
  // Cachen bruges også når tokenet mangler: allerede hentede søgninger virker
  // stadig, så et manglende token ikke gør biblioteket ubrugeligt.
  if (hit !== null) return hit;

  if (!env.BGG_TOKEN) {
    throw new BggAuthError(
      "BoardGameGeek-opslag er ikke sat op. Der mangler et API-token.",
    );
  }

  const response = await fetch(url, {
    headers: {
      accept: "application/xml",
      authorization: `Bearer ${env.BGG_TOKEN}`,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 401 || response.status === 403) {
    // Svarteksten kommer med: BGG skriver hvorfor, og uden den er det umuligt
    // at se forskel på et udløbet, forkert og uregistreret token.
    const body = (await response.text()).slice(0, 200).trim();
    throw new BggAuthError(
      `BoardGameGeek afviste API-tokenet (${response.status}). ${body}`,
    );
  }

  if (!response.ok) {
    throw new Error(`BoardGameGeek svarede ${response.status}`);
  }

  const xml = await response.text();
  store(key, xml);
  return xml;
}

export async function searchGames(query: string): Promise<BggSearchHit[]> {
  const url = `${BASE}/search?type=boardgame&query=${encodeURIComponent(query)}`;
  return parseSearch(await fetchXml(url));
}

export async function gameDetails(bggId: number): Promise<BggDetails | null> {
  return parseThing(await fetchXml(`${BASE}/thing?id=${bggId}`));
}
