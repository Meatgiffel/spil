import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router";
import { Empty, Loading, PendingMark, ScreenHead } from "../components.js";
import { listGroups, listPlays, summarisePlays } from "../db/queries.js";
import { formatDay, formatDuration, plural } from "../format.js";

export function HomeScreen() {
  const navigate = useNavigate();

  const data = useLiveQuery(async () => {
    const [groups, plays] = await Promise.all([listGroups(), listPlays()]);
    return { groups, plays: await summarisePlays(plays.slice(0, 50)) };
  }, []);

  return (
    <main className="screen">
      <ScreenHead title="Spil" right={data ? plural(data.plays.length, "parti", "partier") : ""} />

      <div className="screen-body">
        <button
          className="btn btn-primary btn-block"
          type="button"
          onClick={() => navigate("/nyt-parti")}
          disabled={data !== undefined && data.groups.length === 0}
        >
          Registrer parti
        </button>

        {data === undefined && <Loading />}

        {data && data.groups.length === 0 && (
          <Empty
            title="Ingen grupper endnu"
            body="En gruppe er de mennesker I plejer at spille med. Opret én for at komme i gang."
            action={
              <Link className="btn btn-secondary" to="/grupper">
                Opret gruppe
              </Link>
            }
          />
        )}

        {data && data.groups.length > 0 && data.plays.length === 0 && (
          <Empty
            title="Ingen partier endnu"
            body="Når I har spillet noget, dukker det op her."
          />
        )}

        {data && data.plays.length > 0 && (
          <section className="stack">
            <h2>Seneste partier</h2>
            {data.plays.map((play) => (
              <Link key={play.id} className="card" to={`/partier/${play.id}`}>
                <span className="kicker">
                  {formatDay(play.playedAt)} · {play.groupName}
                </span>
                <span className="card-title">{play.gameTitle}</span>
                <span className="row">
                  <span className="lede grow">
                    {play.summary}
                    {play.participantCount > 0 &&
                      ` · ${plural(play.participantCount, "spiller", "spillere")}`}
                    {formatDuration(play.durationMinutes) &&
                      ` · ${formatDuration(play.durationMinutes)}`}
                  </span>
                  {play.pending && <PendingMark />}
                </span>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
