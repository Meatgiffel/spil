import { useEffect, useRef, useState } from "react";
import { ApiError, api, post } from "../api.js";
import { Field } from "../components.js";
import { translateError, useT } from "../i18n/index.js";
import { sync } from "../db/sync.js";

type Hit = { bggId: number; title: string; year: number | null };

/**
 * Søgning i BoardGameGeek. Serveren proxyer og cacher, så vi hverken rammer
 * CORS eller sender et kald af sted på hvert tastetryk.
 *
 * BGG er langsom og går ned med jævne mellemrum. Derfor er hele komponenten
 * valgfri: fejler den, siger den det og lader brugeren oprette spillet manuelt.
 */
export function BggSearch() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState<number | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // BGG kræver et API-token siden efteråret 2025. Er der ikke sat et, er der
    // ingen grund til at vise et søgefelt der aldrig kan give et resultat.
    void api<{ configured: boolean }>("/api/games/bgg-status")
      .then((body) => setConfigured(body.configured))
      .catch(() => setConfigured(null));
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits(null);
      setState("idle");
      return;
    }

    debounce.current = setTimeout(() => {
      setState("searching");
      setMessage(null);
      void api<{ results: Hit[] }>(`/api/games/search?q=${encodeURIComponent(trimmed)}`)
        .then((body) => {
          setHits(body.results.slice(0, 15));
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
    }, 400);

    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  async function importGame(hit: Hit) {
    setImporting(hit.bggId);
    setMessage(null);
    try {
      await post("/api/games/import", { bggId: hit.bggId });
      setQuery("");
      setHits(null);
      // Spillet er oprettet på serveren — næste pull henter det ned.
      void sync();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? translateError(t, error.code, error.message)
          : t("errors.unknown"),
      );
    } finally {
      setImporting(null);
    }
  }

  if (configured === false) {
    return (
      <p className="lede">{t("bgg.notConfigured")}</p>
    );
  }

  return (
    <section className="stack">
      <Field label={t("bgg.search")}>
        <input
          className="input"
          value={query}
          placeholder={t("bgg.placeholder")}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>

      {state === "searching" && <span className="lede">{t("bgg.searching")}</span>}
      {message && <span className="field-error">{message}</span>}

      {hits?.length === 0 && state === "idle" && (
        <span className="lede">{t("bgg.noHits")}</span>
      )}

      {hits && hits.length > 0 && (
        <div className="stack-tight">
          {hits.map((hit) => (
            <button
              key={hit.bggId}
              className="list-row"
              type="button"
              disabled={importing !== null}
              onClick={() => void importGame(hit)}
            >
              <span className="name">{hit.title}</span>
              {hit.year && <span className="kicker">{hit.year}</span>}
              <span className="kicker" style={{ color: "var(--accent)" }}>
                {importing === hit.bggId ? t("bgg.fetching") : t("bgg.add")}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
