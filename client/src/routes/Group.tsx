import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useParams } from "react-router";
import { v7 as uuidv7 } from "uuid";
import {
  Avatar,
  Empty,
  Field,
  Loading,
  PendingMark,
  ScreenHead,
} from "../components.js";
import { mutate, remove } from "../db/local.js";
import {
  getGroup,
  listGroupPlayers,
  listPlays,
  summarisePlays,
} from "../db/queries.js";
import { sync } from "../db/sync.js";
import { formatDay, plural } from "../format.js";
import { useUser } from "../session.js";

export function GroupScreen() {
  const { groupId = "" } = useParams();
  const user = useUser();
  const navigate = useNavigate();
  const [guestName, setGuestName] = useState("");
  const [adding, setAdding] = useState(false);

  const data = useLiveQuery(async () => {
    const group = await getGroup(groupId);
    if (!group) return null;
    const [players, plays] = await Promise.all([
      listGroupPlayers(groupId),
      listPlays(groupId),
    ]);
    return { group, players, plays: await summarisePlays(plays.slice(0, 20)) };
  }, [groupId]);

  async function addGuest(event: FormEvent) {
    event.preventDefault();
    const trimmed = guestName.trim();
    if (!trimmed) return;

    // En gæst er en spiller uden userId. Partier peger altid på spilleren, så
    // gæsten kan senere kobles til en konto uden at historikken skal skrives om.
    const playerId = uuidv7();
    await mutate("player", { id: playerId, name: trimmed, userId: null }, user);
    await mutate(
      "groupMember",
      { id: uuidv7(), groupId, playerId, role: "member" },
      user,
    );
    setGuestName("");
    setAdding(false);
    void sync();
  }

  if (data === undefined) {
    return (
      <main className="screen">
        <ScreenHead title="Gruppe" back />
        <div className="screen-body">
          <Loading />
        </div>
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="screen">
        <ScreenHead title="Gruppe" back />
        <div className="screen-body">
          <Empty title="Gruppen findes ikke" body="Den er måske blevet slettet." />
        </div>
      </main>
    );
  }

  const { group, players, plays } = data;

  return (
    <main className="screen">
      <ScreenHead title={group.name} back />

      <div className="screen-body">
        <button
          className="btn btn-primary btn-block"
          type="button"
          onClick={() => navigate(`/nyt-parti/${groupId}`)}
        >
          Registrer parti
        </button>

        <section className="stack">
          <div className="spread">
            <h2>Medlemmer</h2>
            <span className="kicker">{plural(players.length, "spiller", "spillere")}</span>
          </div>

          <div className="stack-tight">
            {players.map((player) => (
              <div key={player.id} className="list-row">
                <Avatar name={player.name} guest={player.userId === null} />
                <span className="name">{player.name}</span>
                {player.userId === null && <span className="tag tag-outline">Gæst</span>}
                {player.pending && <PendingMark />}
              </div>
            ))}
          </div>

          {adding ? (
            <form className="stack" onSubmit={addGuest}>
              <Field
                label="Navn på gæsten"
                hint="En gæst har ingen konto. Du kan tilføje dem nu og lade dem oprette sig senere."
              >
                <input
                  className="input"
                  autoFocus
                  value={guestName}
                  maxLength={80}
                  onChange={(event) => setGuestName(event.target.value)}
                />
              </Field>
              <div className="row">
                <button
                  className="btn btn-primary grow"
                  type="submit"
                  disabled={!guestName.trim()}
                >
                  Tilføj
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setAdding(false)}
                >
                  Fortryd
                </button>
              </div>
            </form>
          ) : (
            <button
              className="btn btn-secondary btn-block"
              type="button"
              onClick={() => setAdding(true)}
            >
              Tilføj gæst
            </button>
          )}
        </section>

        <hr className="rule" />

        <section className="stack">
          <div className="spread">
            <h2>Seneste partier</h2>
            <Link className="btn btn-ghost" to={`/grupper/${groupId}/statistik`}>
              Statistik
            </Link>
          </div>

          {plays.length === 0 ? (
            <Empty
              title="Ingen partier endnu"
              body="Registrer det første, så begynder statistikken at give mening."
            />
          ) : (
            <div className="stack-tight">
              {plays.map((play) => (
                <Link key={play.id} className="list-row" to={`/partier/${play.id}`}>
                  <span className="stack-tight grow">
                    <span className="name">{play.gameTitle}</span>
                    <span className="kicker">
                      {formatDay(play.playedAt)}
                      {play.winners.length > 0 && ` · ${play.winners.join(" og ")} vandt`}
                    </span>
                  </span>
                  {play.pending && <PendingMark />}
                </Link>
              ))}
            </div>
          )}
        </section>

        <hr className="rule" />

        <button
          className="btn btn-danger btn-block"
          type="button"
          onClick={async () => {
            if (!confirm(`Slet "${group.name}"? Partierne forsvinder også.`)) return;
            await remove("group", groupId, user);
            void sync();
            navigate("/grupper");
          }}
        >
          Slet gruppe
        </button>
      </div>
    </main>
  );
}
