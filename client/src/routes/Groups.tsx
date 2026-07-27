import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router";
import { v7 as uuidv7 } from "uuid";
import { Empty, Field, Loading, PendingMark, ScreenHead } from "../components.js";
import { mutate } from "../db/local.js";
import { listGroupPlayers, listGroups, ownPlayer } from "../db/queries.js";
import { sync } from "../db/sync.js";
import { plural } from "../format.js";
import { useUser } from "../session.js";

export function GroupsScreen() {
  const user = useUser();
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
      <ScreenHead title="Grupper" />

      <div className="screen-body">
        {open ? (
          <form className="stack" onSubmit={createGroup}>
            <Field label="Navn på gruppen">
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
            className="btn btn-primary btn-block"
            type="button"
            onClick={() => setOpen(true)}
          >
            Ny gruppe
          </button>
        )}

        {groups === undefined && <Loading />}

        {groups?.length === 0 && (
          <Empty
            title="Ingen grupper"
            body="En gruppe samler de spillere I plejer at spille med — både dem med konto og gæster uden."
          />
        )}

        {groups && groups.length > 0 && (
          <section className="stack-tight">
            {groups.map((group) => (
              <Link key={group.id} className="list-row" to={`/grupper/${group.id}`}>
                <span className="name">{group.name}</span>
                {group.pending && <PendingMark />}
                <span className="kicker">{plural(group.memberCount, "medlem", "medlemmer")}</span>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
