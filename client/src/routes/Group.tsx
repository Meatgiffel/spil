import { useEffect, useState, type FormEvent } from "react";
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
import { ApiError, api, post } from "../api.js";
import { translateError } from "../i18n/index.js";
import { formatDay } from "../format.js";
import { useT } from "../i18n/index.js";
import { useUser } from "../session.js";

type Account = { playerId: string; name: string; email: string };

export function GroupScreen() {
  const { groupId = "" } = useParams();
  const user = useUser();
  const navigate = useNavigate();
  const t = useT();
  const [guestName, setGuestName] = useState("");
  const [adding, setAdding] = useState(false);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [pickingMember, setPickingMember] = useState(false);
  const [linking, setLinking] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Kontolisten kommer ikke fra sync: en spiller synkroniseres først når man
  // deler gruppe, og man skal netop kunne finde nogen man ikke deler gruppe med
  // endnu. Derfor hentes den fra serveren når den skal bruges.
  useEffect(() => {
    if (!pickingMember && !linking) return;
    void api<{ accounts: Account[] }>("/api/players/accounts")
      .then((body) => setAccounts(body.accounts))
      .catch(() => {
        setAccounts([]);
        setNotice(t("group.needsConnection"));
      });
  }, [pickingMember, linking, t]);

  const data = useLiveQuery(async () => {
    const group = await getGroup(groupId);
    if (!group) return null;
    const [players, plays] = await Promise.all([
      listGroupPlayers(groupId),
      listPlays(groupId),
    ]);
    return { group, players, plays: await summarisePlays(plays.slice(0, 20), t) };
  }, [groupId, t]);

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

  async function addMember(account: Account) {
    await mutate(
      "groupMember",
      { id: uuidv7(), groupId, playerId: account.playerId, role: "member" },
      user,
    );
    setPickingMember(false);
    void sync();
  }

  async function linkGuest(guest: { id: string; name: string }, account: Account) {
    try {
      await post(`/api/players/${guest.id}/link`, { targetPlayerId: account.playerId });
      setNotice(t("group.linked", { guest: guest.name, name: account.name }));
      setLinking(null);
      // Sammenlægningen skete på serveren; næste pull henter resultatet ned.
      void sync();
    } catch (error) {
      setNotice(
        error instanceof ApiError
          ? translateError(t, error.code, error.message)
          : t("errors.unknown"),
      );
    }
  }

  if (data === undefined) {
    return (
      <main className="screen">
        <ScreenHead title={t("play.groupStep")} back />
        <div className="screen-body">
          <Loading />
        </div>
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="screen">
        <ScreenHead title={t("play.groupStep")} back />
        <div className="screen-body">
          <Empty title={t("group.notFoundTitle")} body={t("group.notFoundBody")} />
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
          onClick={() => navigate(`/plays/new/${groupId}`)}
        >
          {t("home.recordPlay")}
        </button>

        <section className="stack">
          <div className="spread">
            <h2>{t("group.members")}</h2>
            <span className="kicker">{t.count("group.playerCount", players.length)}</span>
          </div>

          {notice && <p className="lede">{notice}</p>}

          <div className="stack-tight">
            {players.map((player) => (
              <div key={player.id} className="list-row">
                <Avatar name={player.name} guest={player.userId === null} />
                <span className="name">{player.name}</span>
                {player.userId === null && (
                  <>
                    <span className="tag tag-outline">{t("group.guest")}</span>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setLinking({ id: player.id, name: player.name });
                      }}
                    >
                      {t("group.linkGuest")}
                    </button>
                  </>
                )}
                {player.pending && <PendingMark />}
              </div>
            ))}
          </div>

          {linking && (
            <section className="card">
              <span className="card-title">
                {t("group.linkTitle", { name: linking.name })}
              </span>
              <p className="lede">{t("group.linkBody")}</p>
              <div className="stack-tight">
                {(accounts ?? []).map((account) => (
                  <button
                    key={account.playerId}
                    className="list-row"
                    type="button"
                    onClick={() => void linkGuest(linking, account)}
                  >
                    <Avatar name={account.name} />
                    <span className="name">{account.name}</span>
                    <span className="kicker">{t("group.linkConfirm")}</span>
                  </button>
                ))}
                {accounts?.length === 0 && (
                  <span className="lede">{t("group.noAccounts")}</span>
                )}
              </div>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setLinking(null)}
              >
                {t("action.cancel")}
              </button>
            </section>
          )}

          {pickingMember && (
            <section className="card">
              <span className="card-title">{t("group.pickAccount")}</span>
              <div className="stack-tight">
                {(accounts ?? [])
                  .filter(
                    (account) => !players.some((row) => row.id === account.playerId),
                  )
                  .map((account) => (
                    <button
                      key={account.playerId}
                      className="list-row"
                      type="button"
                      onClick={() => void addMember(account)}
                    >
                      <Avatar name={account.name} />
                      <span className="name">{account.name}</span>
                      <span className="kicker">{t("group.add")}</span>
                    </button>
                  ))}
                {accounts !== null &&
                  accounts.every((account) =>
                    players.some((row) => row.id === account.playerId),
                  ) && <span className="lede">{t("group.noAccounts")}</span>}
              </div>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setPickingMember(false)}
              >
                {t("action.cancel")}
              </button>
            </section>
          )}

          {adding ? (
            <form className="stack" onSubmit={addGuest}>
              <Field label={t("group.guestName")} hint={t("group.guestHint")}>
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
                  {t("group.add")}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setAdding(false)}
                >
                  {t("action.cancel")}
                </button>
              </div>
            </form>
          ) : (
            <div className="row">
              <button
                className="btn btn-secondary grow"
                type="button"
                onClick={() => {
                  setNotice(null);
                  setPickingMember((value) => !value);
                }}
              >
                {t("group.addMember")}
              </button>
              <button
                className="btn btn-secondary grow"
                type="button"
                onClick={() => setAdding(true)}
              >
                {t("group.addGuest")}
              </button>
            </div>
          )}
        </section>

        <hr className="rule" />

        <section className="stack">
          <div className="spread">
            <h2>{t("group.recentPlays")}</h2>
            <Link className="btn btn-ghost" to={`/groups/${groupId}/stats`}>
              {t("group.stats")}
            </Link>
          </div>

          {plays.length === 0 ? (
            <Empty
              title={t("group.noPlaysTitle")}
              body={t("group.noPlaysBody")}
            />
          ) : (
            <div className="stack-tight">
              {plays.map((play) => (
                <Link key={play.id} className="list-row" to={`/plays/${play.id}`}>
                  <span className="stack-tight grow">
                    <span className="name">{play.gameTitle}</span>
                    <span className="kicker">
                      {formatDay(play.playedAt, t)} · {play.summary}
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
            if (!confirm(t("group.deleteConfirm", { name: group.name }))) return;
            await remove("group", groupId, user);
            void sync();
            navigate("/groups");
          }}
        >
          {t("group.delete")}
        </button>
      </div>
    </main>
  );
}
