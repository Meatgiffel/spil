import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  BggAuthError,
  bggIsConfigured,
  gameDetails,
  gameDetailsBatch,
  searchGames,
} from "../bgg.js";
import { db } from "../db/client.js";
import { game } from "../db/schema.js";
import { env } from "../env.js";
import { HttpError, notFound, parseOrThrow } from "../http.js";
import { requireUser } from "../session.js";
import { allocateServerSeq } from "../sync.js";

export const gamesRouter: Router = Router();

gamesRouter.use(requireUser);

const searchSchema = z.object({
  q: z.string().trim().min(2, { error: "Skriv mindst to tegn." }).max(100),
});

// Frontenden bruger den til at afgøre om søgefeltet overhovedet skal vises.
gamesRouter.get("/bgg-status", (_req, res) => {
  res.json({ configured: bggIsConfigured() });
});

// Så mange træffere beriges med cover og spillerantal. BGG's søgning kan give
// hundredvis, og detaljeopslaget er det dyre kald — listen skal alligevel kunne
// skimmes på en telefon.
const SEARCH_LIMIT = 12;

gamesRouter.get("/search", async (req, res, next) => {
  try {
    const { q } = parseOrThrow(searchSchema, req.query);
    const hits = (await searchGames(q)).slice(0, SEARCH_LIMIT);

    // BGG's søgesvar indeholder hverken cover eller spillerantal — kun id, titel
    // og årstal. Detaljerne hentes i ét samlet thing-kald.
    let details: Awaited<ReturnType<typeof gameDetailsBatch>> = [];
    try {
      details = await gameDetailsBatch(hits.map((hit) => hit.bggId));
    } catch {
      // Et manglende cover må ikke koste søgeresultatet. Titlerne alene er
      // stadig nok til at vælge og importere et spil.
    }
    const byId = new Map(details.map((row) => [row.bggId, row]));

    const results = await Promise.all(
      hits.map(async (hit) => {
        const detail = byId.get(hit.bggId);
        return {
          ...hit,
          minPlayers: detail?.minPlayers ?? null,
          maxPlayers: detail?.maxPlayers ?? null,
          thumbnailPath: detail?.thumbnailUrl
            ? await ensureThumbnail(detail.thumbnailUrl, hit.bggId)
            : null,
        };
      }),
    );

    res.json({ results });
  } catch (error) {
    if (error instanceof HttpError) {
      next(error);
      return;
    }
    if (error instanceof BggAuthError) {
      // Ikke en 503: ingen ventetid løser det, og "prøv igen om lidt" ville
      // sende brugeren i den forkerte retning.
      next(new HttpError(501, "bgg_not_configured", error.message));
      return;
    }
    // BGG er ustabilt. UI'et falder tilbage på manuel oprettelse, så det er
    // ikke en 500 — det er en besked om at den vej ikke virker lige nu.
    next(new HttpError(503, "bgg_unavailable"));
  }
});

const importSchema = z.object({ bggId: z.number().int().min(1) });

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/**
 * Henter coveret ned lokalt, hvis det ikke allerede ligger der.
 *
 * Billederne hentes hjem frem for at blive vist fra BGG's CDN. Dels virker
 * biblioteket så offline, dels er det den samme grund til at selve API'et
 * proxyes: klienten skal ikke selv sende kald til geekdo.
 *
 * Filnavnet er bygget af bgg-id'et, så en søgning der viser det samme spil igen
 * genbruger filen i stedet for at hente den forfra.
 */
async function ensureThumbnail(url: string, bggId: number): Promise<string | null> {
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) return null;

    const filename = `${bggId}${extension}`;
    const directory = path.join(env.UPLOADS_DIR, "games");
    const target = path.join(directory, filename);
    const publicPath = `/uploads/games/${filename}`;
    if (existsSync(target)) return publicPath;

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;

    mkdirSync(directory, { recursive: true });
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    return publicPath;
  } catch {
    // Et manglende cover må aldrig blokere hverken søgning eller import.
    return null;
  }
}

gamesRouter.post("/import", async (req, res, next) => {
  try {
    const { bggId } = parseOrThrow(importSchema, req.body ?? {});

    const existing = db.select().from(game).where(eq(game.bggId, bggId)).get();
    if (existing && existing.deletedAt === null) {
      res.json({ game: existing, alreadyExisted: true });
      return;
    }

    const details = await gameDetails(bggId);
    if (!details) throw notFound("not_found");

    const thumbnailPath = details.thumbnailUrl
      ? await ensureThumbnail(details.thumbnailUrl, bggId)
      : null;

    const row = {
      id: existing?.id ?? uuidv7(),
      title: details.title,
      // Har spillet allerede en type, er den lært af et rigtigt parti og slår
      // BGG's gæt. Ellers sætter vi gættet, som brugeren stadig kan rette.
      defaultOutcomeType: existing?.defaultOutcomeType ?? details.defaultOutcomeType,
      lowScoreWins: existing?.lowScoreWins ?? false,
      bggId: details.bggId,
      year: details.year,
      minPlayers: details.minPlayers,
      maxPlayers: details.maxPlayers,
      thumbnailPath,
      updatedAt: Date.now(),
      // Skrivning uden om sync-push, så sekvensen skal tildeles her.
      serverSeq: allocateServerSeq(),
      deletedAt: null,
      updatedBy: req.user!.id,
    };

    db.insert(game).values(row).onConflictDoUpdate({ target: game.id, set: row }).run();

    res.status(201).json({ game: row, alreadyExisted: false });
  } catch (error) {
    next(
      error instanceof BggAuthError
        ? new HttpError(501, "bgg_not_configured", error.message)
        : error,
    );
  }
});
