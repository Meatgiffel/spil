import { useEffect, useRef, useState } from "react";
import { ApiError, api, post } from "./api.js";
import { sync } from "./db/sync.js";
import { translateError, useT } from "./i18n/index.js";

export type BggHit = {
  bggId: number;
  title: string;
  year: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  /** Sti på vores egen server, ikke hos BGG. Kan mangle. */
  thumbnailPath: string | null;
};

// Længe nok til at man skriver færdig, kort nok til ikke at føles trægt.
const DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 2;

/**
 * Søgning i BoardGameGeek, delt mellem spilbiblioteket og registreringsflowet.
 *
 * Hele opslaget er valgfrit: BGG er langsomt, kræver et token og går ned med
 * jævne mellemrum. Fejler den, siger den det og lader brugeren oprette spillet
 * manuelt — den må aldrig kunne blokere for at få et parti registreret.
 */
export function useBggSearch(query: string) {
  const t = useT();
  const [hits, setHits] = useState<BggHit[] | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // BGG kræver et API-token siden efteråret 2025. Er der ikke sat et, er der
    // ingen grund til at vise noget som helst om BGG.
    void api<{ configured: boolean }>("/api/games/bgg-status")
      .then((body) => setConfigured(body.configured))
      .catch(() => setConfigured(null));
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const trimmed = query.trim();
    if (configured === false || trimmed.length < MIN_QUERY_LENGTH) {
      setHits(null);
      setState("idle");
      setMessage(null);
      return;
    }

    debounce.current = setTimeout(() => {
      setState("searching");
      setMessage(null);
      void api<{ results: BggHit[] }>(`/api/games/search?q=${encodeURIComponent(trimmed)}`)
        .then((body) => {
          setHits(body.results);
          setState("idle");
        })
        .catch((error: unknown) => {
          setState("error");
          setHits(null);
          setMessage(
            error instanceof ApiError
              ? error.status === 0
                ? t("bgg.needsConnection")
                : translateError(t, error.code, error.message)
              : t("errors.unknown"),
          );
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, configured]);

  return { configured, hits, state, message, setMessage };
}

/**
 * Importerer et spil og venter på at det er hentet ned lokalt.
 *
 * Der ventes bevidst på synkroniseringen: kalderen får spillets id og skal
 * kunne slå rækken op i Dexie med det samme bagefter. Uden ventetiden ville
 * man kunne vælge et spil der endnu ikke fandtes lokalt.
 */
export async function importBggGame(bggId: number): Promise<string> {
  const body = await post<{ game: { id: string } }>("/api/games/import", { bggId });
  await sync();
  return body.game.id;
}
