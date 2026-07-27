import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router";
import { Avatar, Empty, Loading, PendingMark, ScreenHead } from "../components.js";
import { queuePhoto, remove } from "../db/local.js";
import {
  getGame,
  getGroup,
  getPlay,
  listParticipants,
  listPhotos,
} from "../db/queries.js";
import { sync } from "../db/sync.js";
import { formatDate, formatDuration, formatSeconds, formatTime } from "../format.js";
import { useT } from "../i18n/index.js";
import { bestPlacement, isWinner, outcomeLabelKey } from "../outcome.js";
import { useUser } from "../session.js";

export function PlayScreen() {
  const { playId = "" } = useParams();
  const user = useUser();
  const navigate = useNavigate();
  const t = useT();

  const data = useLiveQuery(async () => {
    const play = await getPlay(playId);
    if (!play) return null;
    const [game, group, participants, photos] = await Promise.all([
      getGame(play.gameId),
      getGroup(play.groupId),
      listParticipants(playId),
      listPhotos(playId),
    ]);
    return { play, game, group, participants, photos };
  }, [playId]);

  // Blob-URL'erne til billeder der endnu ikke er uploadet skal frigives igen,
  // ellers vokser hukommelsesforbruget for hver gang forespørgslen kører.
  const photos = data?.photos ?? [];
  useEffect(() => {
    return () => {
      for (const photo of photos) {
        if (photo.pending) URL.revokeObjectURL(photo.src);
      }
    };
  }, [photos]);

  if (data === undefined) {
    return (
      <main className="screen">
        <ScreenHead title={t("play.resultStep")} back />
        <div className="screen-body">
          <Loading />
        </div>
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="screen">
        <ScreenHead title={t("play.resultStep")} back />
        <div className="screen-body">
          <Empty title={t("playDetail.notFoundTitle")} body={t("playDetail.notFoundBody")} />
        </div>
      </main>
    );
  }

  const { play, game, group, participants } = data;
  const best = bestPlacement(participants);
  const duration = formatDuration(play.durationMinutes, t);

  return (
    <main className="screen">
      <ScreenHead title={group?.name ?? "Parti"} back />

      <div className="screen-body">
        <div className="stack-tight">
          <span className="kicker">
            {formatDate(play.playedAt)} {t("playDetail.at")} {formatTime(play.playedAt)}
          </span>
          <h1>{game?.title ?? "—"}</h1>
          <span className="lede">
            {[play.location, duration].filter(Boolean).join(" · ") ||
              t("playDetail.noDetails")}
          </span>
          {play.pending && <PendingMark />}
        </div>

        {play.abandoned && (
          <div className="banner">
            <span className="grow">{t("playDetail.notFinished")}</span>
          </div>
        )}

        {!play.abandoned && play.coopResult && (
          <div className={play.coopResult === "won" ? "banner banner-accent" : "banner"}>
            <span className="grow">
              {play.outcomeType === "solo"
                ? play.coopResult === "won"
                  ? t("playDetail.won")
                  : t("playDetail.lost")
                : play.coopResult === "won"
                  ? t("playDetail.teamWonShort")
                  : t("playDetail.teamLostShort")}
            </span>
          </div>
        )}

        {!play.abandoned && play.outcomeType === "teams" && play.winningTeam && (
          <div className="banner banner-accent">
            <span className="grow">{t("playDetail.teamWon", { team: play.winningTeam })}</span>
          </div>
        )}

        {(play.milestone || play.timeRemainingSeconds !== null || play.difficulty) && (
          <section className="stack-tight">
            <h2>{t("playDetail.howFar")}</h2>
            <div className="card card-flat">
              {play.milestone && (
                <div className="spread">
                  <span className="muted">{t("playDetail.reached")}</span>
                  <span className="name">{play.milestone}</span>
                </div>
              )}
              {play.timeRemainingSeconds !== null && (
                <div className="spread">
                  <span className="muted">{t("playDetail.timeLeft")}</span>
                  <span className="name">{formatSeconds(play.timeRemainingSeconds, t)}</span>
                </div>
              )}
              {play.difficulty && (
                <div className="spread">
                  <span className="muted">{t("playDetail.difficultyLabel")}</span>
                  <span className="name">{play.difficulty}</span>
                </div>
              )}
            </div>
          </section>
        )}

        <section className="stack-tight">
          <div className="spread">
            <h2>{t("playDetail.participants")}</h2>
            <span className="kicker">{t(outcomeLabelKey(play.outcomeType))}</span>
          </div>
          {participants.map((row) => {
            const winner = isWinner(play, row, best);
            return (
              <div
                key={row.id}
                className={winner ? "list-row list-row-active" : "list-row"}
              >
                {row.placement !== null && (
                  <span className="rank">{row.placement}.</span>
                )}
                <Avatar
                  name={row.player?.name ?? "?"}
                  guest={row.player?.userId === null}
                  onAccent={winner}
                />
                <span className={winner ? "name name-winner" : "name"}>
                  {row.player?.name ?? "—"}
                </span>
                {row.team && <span className="tag tag-outline">{row.team}</span>}
                {row.score !== null && (
                  <span className="kicker">
                    {t("playDetail.points", { count: row.score })}
                  </span>
                )}
                {winner && <span className="kicker">{t("play.winner")}</span>}
              </div>
            );
          })}
        </section>

        {play.notes && (
          <section className="stack-tight">
            <h2>{t("playDetail.notesHeading")}</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{play.notes}</p>
          </section>
        )}

        <section className="stack-tight">
          <h2>{t("playDetail.photos")}</h2>

          {photos.length > 0 && (
            <div className="grid-2" style={{ display: "grid", gap: "var(--s2)" }}>
              {photos.map((photo) => (
                <figure key={photo.id} style={{ margin: 0, position: "relative" }}>
                  <img
                    src={photo.src}
                    alt=""
                    style={{ width: "100%", aspectRatio: "1", objectFit: "cover" }}
                  />
                  {photo.pending && (
                    <figcaption
                      className="tag tag-outline"
                      style={{ position: "absolute", left: 6, bottom: 6, background: "var(--bg)" }}
                    >
                      {t("playDetail.photoPending")}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          )}

          {/* capture=environment åbner kameraet direkte på telefonen. */}
          <label className="btn btn-secondary btn-block" style={{ cursor: "pointer" }}>
            {t("playDetail.addPhoto")}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                // Billedet gemmes lokalt med det samme og uploades når der er net.
                await queuePhoto(playId, file);
                void sync();
              }}
            />
          </label>
        </section>

        <hr className="rule" />

        <button
          className="btn btn-danger btn-block"
          type="button"
          onClick={async () => {
            if (!confirm(t("playDetail.deleteConfirm"))) return;
            await remove("play", playId, user);
            void sync();
            navigate(-1);
          }}
        >
          {t("playDetail.deletePlay")}
        </button>
      </div>
    </main>
  );
}
