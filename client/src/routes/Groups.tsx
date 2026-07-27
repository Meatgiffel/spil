import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router";
import { v7 as uuidv7 } from "uuid";
import { Empty, Field, Loading, PendingMark, ScreenHead } from "../components.js";
import { mutate } from "../db/local.js";
import { listGroupPlayers, listGroups, ownPlayer } from "../db/queries.js";
import { sync } from "../db/sync.js";
import { useT } from "../i18n/index.js";
import { useUser } from "../session.js";

export function GroupsScreen() {
  const user = useUser();
  const t = useT();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const groups = useLiveQuery(async () => {
    const rows = await listGroups();
    return Promise.all(
      rows.map(async (group) => ({
        ...group,
        memberCount: (await listGroupPlayers(group.id)).length,
      })),
    );
  }, []);

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    const groupId = uuidv7();
    const me = await ownPlayer(user.id);

    // Gruppen og medlemskabet skrives sammen. Serveren tillader netop den
    // kombination: opretteren må lægge sig selv i sin egen nye gruppe.
    await mutate("group", { id: groupId, name: trimmed }, user);
    if (me) {
      await mutate(
        "groupMember",
        { id: uuidv7(), groupId, playerId: me.id, role: "owner" },
        user,
      );
    }
    setName("");
    setOpen(false);
    void sync();
  }

  return (
    <main className="screen">
      <ScreenHead title={t("groups.title")} />

      <div className="screen-body">
        {open ? (
          <form className="stack" onSubmit={createGroup}>
            <Field label={t("groups.name")}>
              <input
                className="input"
                autoFocus
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <div className="row">
              <button className="btn btn-primary grow" type="submit" disabled={!name.trim()}>
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
            className="btn btn-primary btn-block"
            type="button"
            onClick={() => setOpen(true)}
          >
            {t("groups.new")}
          </button>
        )}

        {groups === undefined && <Loading />}

        {groups?.length === 0 && (
          <Empty
            title={t("groups.emptyTitle")}
            body={t("groups.emptyBody")}
          />
        )}

        {groups && groups.length > 0 && (
          <section className="stack-tight">
            {groups.map((group) => (
              <Link key={group.id} className="list-row" to={`/groups/${group.id}`}>
                <span className="name">{group.name}</span>
                {group.pending && <PendingMark />}
                <span className="kicker">
                  {t.count("groups.memberCount", group.memberCount)}
                </span>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
