import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router";
import { v7 as uuidv7 } from "uuid";
import { Avatar, Empty, Field, ScreenHead } from "../components.js";
import { mutate, type LocalPlayer } from "../db/local.js";
import { listGames, listGroupPlayers, listGroups } from "../db/queries.js";
import { sync } from "../db/sync.js";
import { plural } from "../format.js";
import { useUser } from "../session.js";

type Step = "gruppe" | "spil" | "hvem" | "placeringer" | "detaljer";

const FLOW: Step[] = ["spil", "hvem", "placeringer", "detaljer"];

/** Placering pr. spiller. null = ikke placeret endnu. */
type Ranking = Map<string, number>;

export function NewPlayScreen() {
  const user = useUser();
  const navigate = useNavigate();
  const params = useParams();

  const [groupId, setGroupId] = useState(params.groupId ?? "");
  const [step, setStep] = useState<Step>(params.groupId ? "spil" : "gruppe");

  const [gameId, setGameId] = useState("");
  const [newGameTitle, setNewGameTitle] = useState("");
  const [gameFilter, setGameFilter] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ranking, setRanking] = useState<Ranking>(new Map());
  const [tieMode, setTieMode] = useState(false);
  const [coop, setCoop] = useState<null | "won" | "lost">(null);

  const [playedAt, setPlayedAt] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [location, setLocation] = useState("");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const groups = useLiveQuery(() => listGroups(), []);
  const games = useLiveQuery(() => listGames(), []);
  const players = useLiveQuery(
    () => (groupId ? listGroupPlayers(groupId) : Promise.resolve([])),
    [groupId],
  );

  const chosenPlayers = useMemo(
    () => (players ?? []).filter((player) => selected.has(player.id)),
    [players, selected],
  );

  const filteredGames = useMemo(() => {
    const needle = gameFilter.trim().toLowerCase();
    if (!needle) return games ?? [];
    return (games ?? []).filter((game) => game.title.toLowerCase().includes(needle));
  }, [games, gameFilter]);

  const stepIndex = FLOW.indexOf(step);

  function togglePlayer(playerId: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(playerId)) {
        next.delete(playerId);
        setRanking((current) => {
          const updated = new Map(current);
          updated.delete(playerId);
          return updated;
        });
      } else {
        next.add(playerId);
      }
      return next;
    });
  }

  /**
   * Tryk-for-at-rangere. Første tryk giver 1. plads, næste 2. og så videre.
   * Med Uafgjort slået til får den næste samme placering som den forrige.
   */
  function rank(playerId: string) {
    setRanking((current) => {
      const next = new Map(current);
      if (next.has(playerId)) {
        // Tryk igen fjerner placeringen og lukker hullet.
        const removed = next.get(playerId)!;
        next.delete(playerId);
        for (const [id, place] of next) {
          if (place > removed) next.set(id, place - 1);
        }
        return next;
      }
      const places = [...next.values()];
      const highest = places.length === 0 ? 0 : Math.max(...places);
      next.set(playerId, tieMode && highest > 0 ? highest : highest + 1);
      return next;
    });
  }

  function reset() {
    setRanking(new Map());
  }

  async function save() {
    setSaving(true);
    try {
      let finalGameId = gameId;

      if (!finalGameId && newGameTitle.trim()) {
        finalGameId = uuidv7();
        await mutate(
          "game",
          {
            id: finalGameId,
            title: newGameTitle.trim(),
            bggId: null,
            year: null,
            minPlayers: null,
            maxPlayers: null,
            thumbnailPath: null,
          },
          user,
        );
      }
      if (!finalGameId) return;

      const playId = uuidv7();
      const minutes = Number.parseInt(duration, 10);

      await mutate(
        "play",
        {
          id: playId,
          groupId,
          gameId: finalGameId,
          playedAt: new Date(playedAt).getTime(),
          location: location.trim() || null,
          durationMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
          notes: notes.trim() || null,
          coopResult: coop,
        },
        user,
      );

      for (const player of chosenPlayers) {
        await mutate(
          "playParticipant",
          {
            id: uuidv7(),
            playId,
            playerId: player.id,
            placement: coop ? null : (ranking.get(player.id) ?? null),
            score: null,
          },
          user,
        );
      }

      void sync();
      navigate(`/partier/${playId}`, { replace: true });
    } finally {
      setSaving(false);
    }
  }

  // ── Gruppe ──────────────────────────────────────────────────────────────

  if (step === "gruppe") {
    return (
      <main className="screen">
        <ScreenHead title="Gruppe" back={() => navigate(-1)} />
        <div className="screen-body">
          <h2>Hvilken gruppe?</h2>
          {groups?.length === 0 && (
            <Empty title="Ingen grupper" body="Opret en gruppe først." />
          )}
          <div className="stack-tight">
            {(groups ?? []).map((group) => (
              <button
                key={group.id}
                className="list-row"
                type="button"
                onClick={() => {
                  setGroupId(group.id);
                  setStep("spil");
                }}
              >
                <span className="name">{group.name}</span>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  // ── Spil ────────────────────────────────────────────────────────────────

  if (step === "spil") {
    return (
      <main className="screen">
        <ScreenHead
          title="Spil"
          back={() => (params.groupId ? navigate(-1) : setStep("gruppe"))}
          right={`1 / ${FLOW.length}`}
          steps={{ total: FLOW.length, current: 1 }}
        />
        <div className="screen-body">
          <h2>Hvilket spil?</h2>
          <Field label="Søg i biblioteket">
            <input
              className="input"
              value={gameFilter}
              placeholder="Skriv titlen"
              onChange={(event) => {
                setGameFilter(event.target.value);
                setNewGameTitle(event.target.value);
              }}
            />
          </Field>

          <div className="stack-tight">
            {filteredGames.map((game) => (
              <button
                key={game.id}
                className={game.id === gameId ? "list-row list-row-active" : "list-row"}
                type="button"
                onClick={() => {
                  setGameId(game.id);
                  setNewGameTitle("");
                  setStep("hvem");
                }}
              >
                <span className="name">{game.title}</span>
                {game.year && <span className="kicker">{game.year}</span>}
              </button>
            ))}
          </div>

          {gameFilter.trim() && filteredGames.length === 0 && (
            <button
              className="list-row list-row-muted"
              type="button"
              onClick={() => {
                setGameId("");
                setNewGameTitle(gameFilter.trim());
                setStep("hvem");
              }}
            >
              <span className="name">Opret “{gameFilter.trim()}”</span>
              <span className="kicker">Nyt</span>
            </button>
          )}
        </div>
      </main>
    );
  }

  // ── Hvem var med ────────────────────────────────────────────────────────

  if (step === "hvem") {
    return (
      <main className="screen">
        <ScreenHead
          title="Deltagere"
          back={() => setStep("spil")}
          right={`2 / ${FLOW.length}`}
          steps={{ total: FLOW.length, current: 2 }}
        />
        <div className="screen-body">
          <h2>Hvem var med?</h2>
          <div className="stack-tight">
            {(players ?? []).map((player: LocalPlayer) => {
              const on = selected.has(player.id);
              return (
                <button
                  key={player.id}
                  className={on ? "list-row list-row-active" : "list-row"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => togglePlayer(player.id)}
                >
                  <Avatar
                    name={player.name}
                    guest={player.userId === null}
                    onAccent={on}
                  />
                  <span className="name">{player.name}</span>
                  {on && <span className="kicker">MED</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="screen-foot">
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={selected.size === 0}
            onClick={() => setStep("placeringer")}
          >
            Videre · {plural(selected.size, "spiller", "spillere")}
          </button>
        </div>
      </main>
    );
  }

  // ── Placeringer ─────────────────────────────────────────────────────────

  if (step === "placeringer") {
    const ranked = chosenPlayers
      .filter((player) => ranking.has(player.id))
      .sort((a, b) => ranking.get(a.id)! - ranking.get(b.id)!);
    const unranked = chosenPlayers.filter((player) => !ranking.has(player.id));
    const best = ranked.length > 0 ? ranking.get(ranked[0]!.id)! : null;

    return (
      <main className="screen">
        <ScreenHead
          title="Placeringer"
          back={() => setStep("hvem")}
          right={`3 / ${FLOW.length}`}
          steps={{ total: FLOW.length, current: 3 }}
        />

        <div className="screen-body">
          <div className="seg" role="group" aria-label="Type parti">
            <button
              className="seg-opt"
              type="button"
              aria-pressed={coop === null}
              onClick={() => setCoop(null)}
            >
              Placeringer
            </button>
            <button
              className="seg-opt"
              type="button"
              aria-pressed={coop !== null}
              onClick={() => setCoop("won")}
            >
              Co-op
            </button>
          </div>

          {coop === null ? (
            <>
              <div>
                <h2>Tryk i den rækkefølge de endte</h2>
                <p className="lede">
                  Først vinderen. Slå <b>Uafgjort</b> til og tryk to navne lige efter
                  hinanden for delt placering.
                </p>
              </div>

              <div className="stack-tight">
                {ranked.map((player) => {
                  const place = ranking.get(player.id)!;
                  const winner = place === best;
                  return (
                    <button
                      key={player.id}
                      className={winner ? "list-row list-row-active" : "list-row"}
                      type="button"
                      onClick={() => rank(player.id)}
                    >
                      <span className="rank">{place}.</span>
                      <Avatar
                        name={player.name}
                        guest={player.userId === null}
                        onAccent={winner}
                      />
                      <span className={winner ? "name name-winner" : "name"}>
                        {player.name}
                      </span>
                      <span className="kicker">{winner ? "VINDER" : "×"}</span>
                    </button>
                  );
                })}

                {unranked.length > 0 && (
                  <>
                    <hr className="rule" />
                    <span className="kicker">Mangler placering</span>
                    {unranked.map((player) => (
                      <button
                        key={player.id}
                        className="list-row list-row-muted"
                        type="button"
                        onClick={() => rank(player.id)}
                      >
                        <span className="rank rank-empty">–</span>
                        <Avatar name={player.name} guest={player.userId === null} />
                        <span className="name muted">{player.name}</span>
                        <span className="kicker" style={{ color: "var(--accent)" }}>
                          TRYK
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <h2>Hvordan gik det?</h2>
              <div className="seg" role="group" aria-label="Resultat">
                <button
                  className="seg-opt"
                  type="button"
                  aria-pressed={coop === "won"}
                  onClick={() => setCoop("won")}
                >
                  Vi vandt
                </button>
                <button
                  className="seg-opt"
                  type="button"
                  aria-pressed={coop === "lost"}
                  onClick={() => setCoop("lost")}
                >
                  Vi tabte
                </button>
              </div>
            </>
          )}
        </div>

        <div className="screen-foot">
          {coop === null && (
            <div className="row">
              <button
                className="btn btn-secondary grow"
                type="button"
                aria-pressed={tieMode}
                style={
                  tieMode
                    ? { background: "var(--accent)", color: "var(--accent-ink)" }
                    : undefined
                }
                onClick={() => setTieMode((value) => !value)}
              >
                Uafgjort {tieMode ? "til" : "fra"}
              </button>
              <button className="btn btn-secondary" type="button" onClick={reset}>
                Ryd
              </button>
            </div>
          )}
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={coop === null && ranking.size === 0}
            onClick={() => setStep("detaljer")}
          >
            Videre
          </button>
        </div>
      </main>
    );
  }

  // ── Detaljer ────────────────────────────────────────────────────────────

  return (
    <main className="screen">
      <ScreenHead
        title="Detaljer"
        back={() => setStep("placeringer")}
        right={`4 / ${FLOW.length}`}
        steps={{ total: FLOW.length, current: 4 }}
      />
      <div className="screen-body">
        <Field label="Hvornår">
          <input
            className="input"
            type="datetime-local"
            value={playedAt}
            onChange={(event) => setPlayedAt(event.target.value)}
          />
        </Field>
        <Field label="Hvor (valgfrit)">
          <input
            className="input"
            value={location}
            maxLength={120}
            placeholder="Hjemme hos…"
            onChange={(event) => setLocation(event.target.value)}
          />
        </Field>
        <Field label="Varighed i minutter (valgfrit)">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </Field>
        <Field label="Noter (valgfrit)">
          <textarea
            className="input"
            value={notes}
            maxLength={4000}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </div>
      <div className="screen-foot">
        <button
          className="btn btn-primary btn-block"
          type="button"
          disabled={saving || (!gameId && !newGameTitle.trim())}
          onClick={() => void save()}
        >
          {saving ? "Gemmer…" : "Gem parti"}
        </button>
      </div>
    </main>
  );
}
