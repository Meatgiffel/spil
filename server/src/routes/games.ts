import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { BggAuthError, bggIsConfigured, gameDetails, searchGames } from "../bgg.js";
import { db } from "../db/client.js";
import { game } from "../db/schema.js";
import { env } from "../env.js";
import { HttpError, badRequest, parseOrThrow } from "../http.js";
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

gamesRouter.get("/search", async (req, res, next) => {
  try {
    const { q } = parseOrThrow(searchSchema, req.query);
    res.json({ results: await searchGames(q) });
  } catch (error) {
    if (error instanceof HttpError) {
      next(error);
      return;
    }
    if (error instanceof BggAuthError) {
      // Ikke en 503: ingen ventetid løser det, og "prøv igen om lidt" ville
      // sende brugeren i den forkerte retning.
      next(new HttpError(501, error.message));
      return;
    }
    // BGG er ustabilt. UI'et falder tilbage på manuel oprettelse, så det er
    // ikke en 500 — det er en besked om at den vej ikke virker lige nu.
    next(
      new HttpError(
        503,
        "BoardGameGeek svarer ikke lige nu. Opret spillet manuelt i stedet.",
      ),
    );
  }
});

const importSchema = z.object({ bggId: z.number().int().min(1) });

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/** Henter thumbnailen ned lokalt, så biblioteket også virker offline. */
async function downloadThumbnail(url: string, bggId: number): Promise<string | null> {
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) return null;

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;

    const directory = path.join(env.UPLOADS_DIR, "games");
    mkdirSync(directory, { recursive: true });
    const filename = `${bggId}${extension}`;
    await writeFile(
      path.join(directory, filename),
      Buffer.from(await response.arrayBuffer()),
    );
    return `/uploads/games/${filename}`;
  } catch {
    // Et manglende cover må aldrig blokere importen.
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
    if (!details) throw badRequest("Spillet blev ikke fundet på BoardGameGeek.");

    const thumbnailPath = details.thumbnailUrl
      ? await downloadThumbnail(details.thumbnailUrl, bggId)
      : null;

    const row = {
      id: existing?.id ?? uuidv7(),
      title: details.title,
      defaultOutcomeType: existing?.defaultOutcomeType ?? null,
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
    next(error instanceof BggAuthError ? new HttpError(501, error.message) : error);
  }
});
