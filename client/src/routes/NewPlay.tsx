import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router";
import { v7 as uuidv7 } from "uuid";
import { OUTCOME_TYPES, type OutcomeType } from "@spil/shared";
import { Avatar, Empty, Field, ScreenHead } from "../components.js";
import { mutate, type LocalPlayer } from "../db/local.js";
import { listGames, listGroupPlayers, listGroups } from "../db/queries.js";
import { sync } from "../db/sync.js";
import { plural } from "../format.js";
import { OUTCOME_HINTS, OUTCOME_LABELS, placementsFromScores } from "../outcome.js";
import { useUser } from "../session.js";

type Step = "gruppe" | "spil" | "hvem" | "resultat" | "detaljer";

const FLOW: Step[] = ["spil", "hvem", "resultat", "detaljer"];

/** Standardnavne på hold. Kan overskrives, men dækker de fleste tilfælde. */
const DEFAULT_TEAMS = ["Hold 1", "Hold 2"];

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
  const [outcomeType, setOutcomeType] = useState<OutcomeType>("ranking");
  const [ranking, setRanking] = useState<Map<string, number>>(new Map());
  const [tieMode, setTieMode] = useState(false);
  const [scores, setScores] = useState<Map<string, string>>(new Map());
  const [lowScoreWins, setLowScoreWins] = useState(false);
  const [teams, setTeams] = useState<Map<string, string>>(new Map());
  const [winningTeam, setWinningTeam] = useState<string | null>(null);
  const [coop, setCoop] = useState<"won" | "lost" | null>(null);
  const [abandoned, setAbandoned] = useState(false);

  const [milestone, setMilestone] = useState("");
  const [timeRemaining, setTimeRemaining] = useState("");
  const [difficulty, setDifficulty] = useState("");

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

  const chosenGame = useMemo(
    () => (games ?? []).find((game) => game.id === gameId),
    [games, gameId],
  );

  // Spillet husker sin udfaldstype, så man kun vælger den første gang.
  useEffect(() => {
    if (!chosenGame) return;
    if (chosenGame.defaultOutcomeType) {
      setOutcomeType(chosenGame.defaultOutcomeType as OutcomeType);
    }
    setLowScoreWins(chosenGame.lowScoreWins);
  }, [chosenGame]);

  const chosenPlayers = useMemo(
    () => (players ?? []).filter((player) => selected.has(player.id)),
    [players, selected],
  );

  const filteredGames = useMemo(() => {
    const needle = gameFilter.trim().toLowerCase();
    if (!needle) return games ?? [];
    return (games ?? []).filter((game) => game.title.toLowerCase().includes(needle));
  }, [games, gameFilter]);

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

  function cycleTeam(playerId: string) {
    setTeams((current) => {
      const next = new Map(current);
      const names = teamNames();
      const now = next.get(playerId);
      const index = now === undefined ? -1 : names.indexOf(now);
      next.set(playerId, names[(index + 1) % names.length]!);
      return next;
    });
  }

  function teamNames(): string[] {
    const used = [...new Set([...teams.values()])].filter(Boolean);
    return used.length >= 2 ? used : DEFAULT_TEAMS;
  }

  /** Er resultat-trinnet udfyldt nok til at gå videre? */
  function resultatKlar(): boolean {
    if (abandoned) return true;
    switch (outcomeType) {
      case "ranking":
        return ranking.size > 0;
      case "score":
        return [...scores.values()].some((value) => value.trim() !== "");
      case "coop":
      case "solo":
        return coop !== null;
      case "teams":
        return winningTeam !== null && teams.size > 0;
    }
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
            defaultOutcomeType: outcomeType,
            lowScoreWins,
            bggId: null,
            year: null,
            minPlayers: null,
            maxPlayers: null,
            thumbnailPath: null,
          },
          user,
        );
      } else if (chosenGame) {
        // Husk valget til næste gang spillet registreres.
        if (
          chosenGame.defaultOutcomeType !== outcomeType ||
          chosenGame.lowScoreWins !== lowScoreWins
        ) {
          await mutate(
            "game",
            { ...chosenGame, defaultOutcomeType: outcomeType, lowScoreWins },
            user,
          );
        }
      }
      if (!finalGameId) return;

      const playId = uuidv7();
      const minutes = Number.parseInt(duration, 10);
      const seconds = Number.parseInt(timeRemaining, 10);

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
          outcomeType,
          coopResult:
            abandoned || (outcomeType !== "coop" && outcomeType !== "solo") ? null : coop,
          winningTeam: abandoned || outcomeType !== "teams" ? null : winningTeam,
          milestone: milestone.trim() || null,
          timeRemainingSeconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
          difficulty: difficulty.trim() || null,
          abandoned,
        },
        user,
      );

      // Placeringer regnes ud af point, så statistikken kun har ét felt at se på.
      const numericScores = new Map(
        chosenPlayers.map((player) => {
          const raw = scores.get(player.id)?.trim() ?? "";
          const value = Number.parseInt(raw, 10);
          return [player.id, raw !== "" && Number.isFinite(value) ? value : null];
        }),
      );
      const derived =
        outcomeType === "score"
          ? placementsFromScores(numericScores, lowScoreWins)
          : new Map<string, number | null>();

      for (const player of chosenPlayers) {
        const placement = abandoned
          ? null
          : outcomeType === "ranking"
            ? (ranking.get(player.id) ?? null)
            : outcomeType === "score"
              ? (derived.get(player.id) ?? null)
              : null;

        await mutate(
          "playParticipant",
          {
            id: uuidv7(),
            playId,
            playerId: player.id,
            placement,
            team: outcomeType === "teams" ? (teams.get(player.id) ?? null) : null,
            score: outcomeType === "score" ? numericScores.get(player.id) : null,
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
                {game.defaultOutcomeType && (
                  <span className="kicker">
                    {OUTCOME_LABELS[game.defaultOutcomeType as OutcomeType]}
                  </span>
                )}
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
                  <Avatar name={player.name} guest={player.userId === null} onAccent={on} />
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
            onClick={() => setStep("resultat")}
          >
            Videre · {plural(selected.size, "spiller", "spillere")}
          </button>
        </div>
      </main>
    );
  }

  // ── Resultat ────────────────────────────────────────────────────────────

  if (step === "resultat") {
    const ranked = chosenPlayers
      .filter((player) => ranking.has(player.id))
      .sort((a, b) => ranking.get(a.id)! - ranking.get(b.id)!);
    const unranked = chosenPlayers.filter((player) => !ranking.has(player.id));
    const best = ranked.length > 0 ? ranking.get(ranked[0]!.id)! : null;

    return (
      <main className="screen">
        <ScreenHead
          title="Resultat"
          back={() => setStep("hvem")}
          right={`3 / ${FLOW.length}`}
          steps={{ total: FLOW.length, current: 3 }}
        />

        <div className="screen-body">
          <div className="stack-tight">
            <span className="kicker">Sådan afgøres spillet</span>
            <div className="seg" role="group" aria-label="Type resultat">
              {OUTCOME_TYPES.map((type) => (
                <button
                  key={type}
                  className="seg-opt"
                  type="button"
                  aria-pressed={outcomeType === type}
                  onClick={() => setOutcomeType(type)}
                >
                  {OUTCOME_LABELS[type]}
                </button>
              ))}
            </div>
            <span className="lede">{OUTCOME_HINTS[outcomeType]}</span>
          </div>

          {abandoned ? (
            <div className="empty">
              <h3>Partiet blev afbrudt</h3>
              <p className="lede">
                Det bliver gemt uden vinder og tæller ikke med i sejrsstatistikken.
              </p>
            </div>
          ) : (
            <>
              {outcomeType === "ranking" && (
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
              )}

              {outcomeType === "score" && (
                <div className="stack-tight">
                  {chosenPlayers.map((player) => (
                    <div key={player.id} className="list-row">
                      <Avatar name={player.name} guest={player.userId === null} />
                      <span className="name">{player.name}</span>
                      <input
                        className="input"
                        style={{ width: 96, minHeight: 44 }}
                        type="number"
                        inputMode="numeric"
                        aria-label={`Point til ${player.name}`}
                        value={scores.get(player.id) ?? ""}
                        onChange={(event) =>
                          setScores((current) =>
                            new Map(current).set(player.id, event.target.value),
                          )
                        }
                      />
                    </div>
                  ))}
                  <button
                    className="btn btn-secondary"
                    type="button"
                    aria-pressed={lowScoreWins}
                    style={
                      lowScoreWins
                        ? { background: "var(--accent)", color: "var(--accent-ink)" }
                        : undefined
                    }
                    onClick={() => setLowScoreWins((value) => !value)}
                  >
                    {lowScoreWins ? "Færrest point vinder" : "Flest point vinder"}
                  </button>
                </div>
              )}

              {(outcomeType === "coop" || outcomeType === "solo") && (
                <div className="stack">
                  <div className="seg" role="group" aria-label="Resultat">
                    <button
                      className="seg-opt"
                      type="button"
                      aria-pressed={coop === "won"}
                      onClick={() => setCoop("won")}
                    >
                      {outcomeType === "solo" ? "Jeg vandt" : "Vi vandt"}
                    </button>
                    <button
                      className="seg-opt"
                      type="button"
                      aria-pressed={coop === "lost"}
                      onClick={() => setCoop("lost")}
                    >
                      {outcomeType === "solo" ? "Jeg tabte" : "Vi tabte"}
                    </button>
                  </div>
                </div>
              )}

              {outcomeType === "teams" && (
                <div className="stack">
                  <span className="lede">Tryk på en spiller for at skifte hold.</span>
                  <div className="stack-tight">
                    {chosenPlayers.map((player) => {
                      const team = teams.get(player.id);
                      const winner = team !== undefined && team === winningTeam;
                      return (
                        <button
                          key={player.id}
                          className={winner ? "list-row list-row-active" : "list-row"}
                          type="button"
                          onClick={() => cycleTeam(player.id)}
                        >
                          <Avatar
                            name={player.name}
                            guest={player.userId === null}
                            onAccent={winner}
                          />
                          <span className="name">{player.name}</span>
                          <span className="kicker">{team ?? "VÆLG HOLD"}</span>
                        </button>
                      );
                    })}
                  </div>

                  <hr className="rule" />
                  <span className="kicker">Hvilket hold vandt?</span>
                  <div className="seg" role="group" aria-label="Vindende hold">
                    {teamNames().map((name) => (
                      <button
                        key={name}
                        className="seg-opt"
                        type="button"
                        aria-pressed={winningTeam === name}
                        onClick={() => setWinningTeam(name)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Milepæl og resttid giver kun mening når man kan tabe undervejs. */}
              {(outcomeType === "coop" || outcomeType === "solo") && (
                <>
                  <hr className="rule" />
                  <Field
                    label="Hvor langt nåede I? (valgfrit)"
                    hint="Fx “Boss 4” eller “Mission 23”."
                  >
                    <input
                      className="input"
                      value={milestone}
                      maxLength={60}
                      onChange={(event) => setMilestone(event.target.value)}
                    />
                  </Field>
                  <Field label="Sekunder tilbage (valgfrit)">
                    <input
                      className="input"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={timeRemaining}
                      onChange={(event) => setTimeRemaining(event.target.value)}
                    />
                  </Field>
                  <Field label="Sværhedsgrad (valgfrit)">
                    <input
                      className="input"
                      value={difficulty}
                      maxLength={40}
                      placeholder="Fx “Heroic”"
                      onChange={(event) => setDifficulty(event.target.value)}
                    />
                  </Field>
                </>
              )}
            </>
          )}
        </div>

        <div className="screen-foot">
          <div className="row">
            {outcomeType === "ranking" && !abandoned && (
              <>
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
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setRanking(new Map())}
                >
                  Ryd
                </button>
              </>
            )}
            <button
              className={abandoned ? "btn btn-primary grow" : "btn btn-secondary grow"}
              type="button"
              aria-pressed={abandoned}
              onClick={() => setAbandoned((value) => !value)}
            >
              {abandoned ? "Afbrudt ✓" : "Vi spillede ikke færdig"}
            </button>
          </div>
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={!resultatKlar()}
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
        back={() => setStep("resultat")}
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
