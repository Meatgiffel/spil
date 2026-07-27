import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { v7 as uuidv7 } from "uuid";
import { Empty, Field, Loading, PendingMark, ScreenHead } from "../components.js";
import { mutate } from "../db/local.js";
import { listGames } from "../db/queries.js";
import { sync } from "../db/sync.js";
import { useT } from "../i18n/index.js";
import { useUser } from "../session.js";
import { BggSearch } from "./BggSearch.js";

export function GamesScreen() {
  const user = useUser();
  const t = useT();
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);

  const games = useLiveQuery(() => listGames(), []);

  async function createGame(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    await mutate(
      "game",
      {
        id: uuidv7(),
        title: trimmed,
        bggId: null,
        year: null,
        minPlayers: null,
        maxPlayers: null,
        thumbnailPath: null,
      },
      user,
    );
    setTitle("");
    setOpen(false);
    void sync();
  }

  return (
    <main className="screen">
      <ScreenHead
        title={t("games.title")}
        right={games ? t.count("games.titleCount", games.length) : ""}
      />

      <div className="screen-body">
        <BggSearch />

        {open ? (
          <form className="stack" onSubmit={createGame}>
            <Field label={t("games.gameTitle")}>
              <input
                className="input"
                autoFocus
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <div className="row">
              <button className="btn btn-primary grow" type="submit" disabled={!title.trim()}>
                {t("action.create")}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setOpen(false)}
              >
                {t("action.cancel")}
              </button>
            </div>
          </form>
        ) : (
          <button
            className="btn btn-secondary btn-block"
            type="button"
            onClick={() => setOpen(true)}
          >
            {t("games.createManually")}
          </button>
        )}

        {games === undefined && <Loading />}

        {games?.length === 0 && (
          <Empty
            title={t("games.emptyTitle")}
            body={t("games.emptyBody")}
          />
        )}

        {games && games.length > 0 && (
          <div className="stack-tight">
            {games.map((game) => (
              <div key={game.id} className="list-row">
                {game.thumbnailPath ? (
                  <img
                    src={game.thumbnailPath}
                    alt=""
                    width={34}
                    height={34}
                    style={{ objectFit: "cover", flex: "none" }}
                  />
                ) : (
                  <span className="avatar avatar-guest" aria-hidden="true">
                    {game.title.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="name">{game.title}</span>
                {game.year && <span className="kicker">{game.year}</span>}
                {game.pending && <PendingMark />}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
