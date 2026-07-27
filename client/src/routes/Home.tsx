import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router";
import { Empty, Loading, PendingMark, ScreenHead } from "../components.js";
import { listGroups, listPlays, summarisePlays } from "../db/queries.js";
import { formatDay, formatDuration } from "../format.js";
import { useT } from "../i18n/index.js";

export function HomeScreen() {
  const navigate = useNavigate();
  const t = useT();

  const data = useLiveQuery(async () => {
    const [groups, plays] = await Promise.all([listGroups(), listPlays()]);
    return { groups, plays: await summarisePlays(plays.slice(0, 50), t) };
  }, [t]);

  return (
    <main className="screen">
      <ScreenHead
        title={t("app.name")}
        right={data ? t.count("home.playCount", data.plays.length) : ""}
      />

      <div className="screen-body">
        <button
          className="btn btn-primary btn-block"
          type="button"
          onClick={() => navigate("/plays/new")}
          disabled={data !== undefined && data.groups.length === 0}
        >
          {t("home.recordPlay")}
        </button>

        {data === undefined && <Loading />}

        {data && data.groups.length === 0 && (
          <Empty
            title={t("home.noGroupsTitle")}
            body={t("home.noGroupsBody")}
            action={
              <Link className="btn btn-secondary" to="/groups">
                {t("home.createGroup")}
              </Link>
            }
          />
        )}

        {data && data.groups.length > 0 && data.plays.length === 0 && (
          <Empty
            title={t("home.noPlaysTitle")}
            body={t("home.noPlaysBody")}
          />
        )}

        {data && data.plays.length > 0 && (
          <section className="stack">
            <h2>{t("home.recentPlays")}</h2>
            {data.plays.map((play) => (
              <Link key={play.id} className="card" to={`/plays/${play.id}`}>
                <span className="kicker">
                  {formatDay(play.playedAt, t)} · {play.groupName}
                </span>
                <span className="card-title">{play.gameTitle}</span>
                <span className="row">
                  <span className="lede grow">
                    {play.summary}
                    {play.participantCount > 0 &&
                      ` · ${t.count("group.playerCount", play.participantCount)}`}
                    {formatDuration(play.durationMinutes, t) &&
                      ` · ${formatDuration(play.durationMinutes, t)}`}
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
