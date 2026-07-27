import { useEffect, useRef, useState } from "react";
import { ApiError, api, post } from "../api.js";
import { Field } from "../components.js";
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
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState<number | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            error instanceof ApiError && error.status === 0
              ? "Søgning kræver forbindelse."
              : error instanceof ApiError
                ? error.message
                : "Kunne ikke søge.",
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
      setMessage(error instanceof ApiError ? error.message : "Kunne ikke hente spillet.");
    } finally {
      setImporting(null);
    }
  }

  return (
    <section className="stack">
      <Field label="Søg på BoardGameGeek">
        <input
          className="input"
          value={query}
          placeholder="Fx Vingespil"
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>

      {state === "searching" && <span className="lede">Søger…</span>}
      {message && <span className="field-error">{message}</span>}

      {hits?.length === 0 && state === "idle" && (
        <span className="lede">Ingen træffere. Opret spillet manuelt i stedet.</span>
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
                {importing === hit.bggId ? "HENTER" : "TILFØJ"}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
