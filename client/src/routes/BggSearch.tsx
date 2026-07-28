import { useState } from "react";
import { ApiError } from "../api.js";
import { importBggGame, useBggSearch, type BggHit } from "../bgg.js";
import { Field, GameCover } from "../components.js";
import { translateError, useT } from "../i18n/index.js";

/**
 * Søgning i BoardGameGeek på spilbiblioteket.
 *
 * Registreringsflowet har sin egen indgang til det samme — se NewPlay. Denne
 * her findes stadig, fordi man også vil kunne bygge biblioteket op i forvejen,
 * uden at være midt i at registrere et parti.
 */
export function BggSearch() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState<number | null>(null);
  const { configured, hits, state, message, setMessage } = useBggSearch(query);

  async function importGame(hit: BggHit) {
    setImporting(hit.bggId);
    setMessage(null);
    try {
      await importBggGame(hit.bggId);
      setQuery("");
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
    return <p className="lede">{t("bgg.notConfigured")}</p>;
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
              <GameCover title={hit.title} path={hit.thumbnailPath} />
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
