import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { bggCache } from "./db/schema.js";
import { parseSearch, parseThing, type BggDetails, type BggSearchHit } from "./bgg-parse.js";

export type { BggDetails, BggSearchHit } from "./bgg-parse.js";
export { parseSearch, parseThing } from "./bgg-parse.js";

const BASE = "https://boardgamegeek.com/xmlapi2";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
  if (hit !== null) return hit;

  const response = await fetch(url, {
    headers: { accept: "application/xml" },
    signal: AbortSignal.timeout(10_000),
  });
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
