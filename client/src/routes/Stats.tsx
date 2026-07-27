import { useLiveQuery } from "dexie-react-hooks";
import { useParams } from "react-router";
import { Empty, Loading, ScreenHead } from "../components.js";
import { getGroup, groupStats } from "../db/queries.js";
import { useT } from "../i18n/index.js";

export function StatsScreen() {
  const { groupId = "" } = useParams();
  const t = useT();

  const data = useLiveQuery(async () => {
    const group = await getGroup(groupId);
    if (!group) return null;
    return { group, stats: await groupStats(groupId) };
  }, [groupId]);

  if (data === undefined) {
    return (
      <main className="screen">
        <ScreenHead title={t("stats.title")} back />
        <div className="screen-body">
          <Loading />
        </div>
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="screen">
        <ScreenHead title={t("stats.title")} back />
        <div className="screen-body">
          <Empty title={t("group.notFoundTitle")} body={t("group.notFoundBody")} />
        </div>
      </main>
    );
  }

  const { group, stats } = data;

  if (stats.totalPlays === 0) {
    return (
      <main className="screen">
        <ScreenHead title={group.name} back />
        <div className="screen-body">
          <Empty
            title={t("stats.emptyTitle")}
            body={t("stats.emptyBody")}
          />
        </div>
      </main>
    );
  }

  const mostWins = Math.max(...stats.players.map((player) => player.wins), 1);

  return (
    <main className="screen">
      <ScreenHead
        title={group.name}
        back
        right={t.count("home.playCount", stats.totalPlays)}
      />

      <div className="screen-body">
        <section className="stack">
          <h2>{t("stats.whoWinsMost")}</h2>
          <div className="stack-tight">
            {stats.players.map((player) => (
              <div key={player.playerId} className="card card-flat">
                <div className="spread">
                  <span className="name">{player.name}</span>
                  <span className="kicker">
                    {t("stats.outOf", { wins: player.wins, plays: player.plays })}
                  </span>
                </div>
                {/* Simpel andelsvisning — ingen graf, ingen ekstra afhængighed. */}
                <div
                  style={{
                    height: 8,
                    background: "var(--rule)",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${(player.wins / mostWins) * 100}%`,
                      background: "var(--accent)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <hr className="rule" />

        <section className="stack">
          <h2>{t("stats.mostPlayed")}</h2>
          <div className="stack-tight">
            {stats.topGames.map((game) => (
              <div key={game.gameId} className="list-row">
                <span className="name">{game.title}</span>
                <span className="kicker">{t.count("stats.timesPlayed", game.count)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
