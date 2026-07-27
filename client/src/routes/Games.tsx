import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { v7 as uuidv7 } from "uuid";
import { Empty, Field, Loading, PendingMark, ScreenHead } from "../components.js";
import { mutate } from "../db/local.js";
import { listGames } from "../db/queries.js";
import { sync } from "../db/sync.js";
import { plural } from "../format.js";
import { useUser } from "../session.js";
import { BggSearch } from "./BggSearch.js";

export function GamesScreen() {
  const user = useUser();
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
        title="Spil"
        right={games ? plural(games.length, "titel", "titler") : ""}
      />

      <div className="screen-body">
        <BggSearch />

        {open ? (
          <form className="stack" onSubmit={createGame}>
            <Field label="Titel">
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
                Opret
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setOpen(false)}
              >
                Fortryd
              </button>
            </div>
          </form>
        ) : (
          <button
            className="btn btn-secondary btn-block"
            type="button"
            onClick={() => setOpen(true)}
          >
            Opret spil manuelt
          </button>
        )}

        {games === undefined && <Loading />}

        {games?.length === 0 && (
          <Empty
            title="Biblioteket er tomt"
            body="Søg i BoardGameGeek eller opret en titel selv. Biblioteket deles af alle på installationen."
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
