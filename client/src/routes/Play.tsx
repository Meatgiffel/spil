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
import { formatDate, formatDuration, formatTime } from "../format.js";
import { useUser } from "../session.js";

export function PlayScreen() {
  const { playId = "" } = useParams();
  const user = useUser();
  const navigate = useNavigate();

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
        <ScreenHead title="Parti" back />
        <div className="screen-body">
          <Loading />
        </div>
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="screen">
        <ScreenHead title="Parti" back />
        <div className="screen-body">
          <Empty title="Partiet findes ikke" body="Det er måske blevet slettet." />
        </div>
      </main>
    );
  }

  const { play, game, group, participants } = data;
  const best = participants.reduce<number | null>(
    (lowest, row) =>
      row.placement === null
        ? lowest
        : lowest === null
          ? row.placement
          : Math.min(lowest, row.placement),
    null,
  );
  const duration = formatDuration(play.durationMinutes);

  return (
    <main className="screen">
      <ScreenHead title={group?.name ?? "Parti"} back />

      <div className="screen-body">
        <div className="stack-tight">
          <span className="kicker">
            {formatDate(play.playedAt)} kl. {formatTime(play.playedAt)}
          </span>
          <h1>{game?.title ?? "Ukendt spil"}</h1>
          <span className="lede">
            {[play.location, duration].filter(Boolean).join(" · ") || "Ingen detaljer"}
          </span>
          {play.pending && <PendingMark />}
        </div>

        {play.coopResult && (
          <div className={play.coopResult === "won" ? "banner banner-accent" : "banner"}>
            <span className="grow">
              {play.coopResult === "won" ? "Holdet vandt." : "Holdet tabte."}
            </span>
          </div>
        )}

        <section className="stack-tight">
          <h2>Deltagere</h2>
          {participants.map((row) => {
            const winner = row.placement !== null && row.placement === best;
            return (
              <div
                key={row.id}
                className={winner ? "list-row list-row-active" : "list-row"}
              >
                <span className="rank">
                  {row.placement === null ? "–" : `${row.placement}.`}
                </span>
                <Avatar
                  name={row.player?.name ?? "?"}
                  guest={row.player?.userId === null}
                  onAccent={winner}
                />
                <span className={winner ? "name name-winner" : "name"}>
                  {row.player?.name ?? "Ukendt"}
                </span>
                {winner && <span className="kicker">VINDER</span>}
              </div>
            );
          })}
        </section>

        {play.notes && (
          <section className="stack-tight">
            <h2>Noter</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{play.notes}</p>
          </section>
        )}

        <section className="stack-tight">
          <h2>Billeder</h2>

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
                      Sendes senere
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          )}

          {/* capture=environment åbner kameraet direkte på telefonen. */}
          <label className="btn btn-secondary btn-block" style={{ cursor: "pointer" }}>
            Tilføj billede
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
            if (!confirm("Slet partiet?")) return;
            await remove("play", playId, user);
            void sync();
            navigate(-1);
          }}
        >
          Slet parti
        </button>
      </div>
    </main>
  );
}
