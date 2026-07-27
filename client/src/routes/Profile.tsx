import { Link } from "react-router";
import { Empty, ScreenHead } from "../components.js";
import { formatDate, formatTime } from "../format.js";
import { sync } from "../db/sync.js";
import { useSession, useSyncStatus, useUser } from "../session.js";

const STATE_LABELS: Record<string, string> = {
  idle: "Synkroniseret",
  syncing: "Synkroniserer…",
  offline: "Offline",
  needsReauth: "Log ind igen",
  error: "Kunne ikke synkronisere",
};

export function ProfileScreen() {
  const user = useUser();
  const { signOut } = useSession();
  const status = useSyncStatus();

  return (
    <main className="screen">
      <ScreenHead title="Profil" />

      <div className="screen-body">
        <div className="stack-tight">
          <h1>{user.name}</h1>
          <span className="lede">{user.email}</span>
          {user.role === "admin" && <span className="tag tag-accent">Administrator</span>}
        </div>

        <hr className="rule" />

        <section className="stack-tight">
          <h2>Synkronisering</h2>
          <div className="card card-flat">
            <div className="spread">
              <span className="name">{STATE_LABELS[status.state] ?? status.state}</span>
              {status.pending > 0 && (
                <span className="kicker">{status.pending} i kø</span>
              )}
            </div>
            <span className="lede">
              {status.lastSyncedAt
                ? `Senest ${formatDate(status.lastSyncedAt)} kl. ${formatTime(status.lastSyncedAt)}`
                : "Endnu ikke synkroniseret på denne enhed."}
            </span>
          </div>
          <button className="btn btn-secondary btn-block" type="button" onClick={() => void sync()}>
            Synkronisér nu
          </button>
        </section>

        {user.role === "admin" && (
          <>
            <hr className="rule" />
            <section className="stack-tight">
              <h2>Administration</h2>
              <Link className="btn btn-secondary btn-block" to="/noegler">
                Invitationsnøgler
              </Link>
            </section>
          </>
        )}

        <hr className="rule" />

        {status.pending > 0 && (
          <Empty
            title="Der ligger ændringer i kø"
            body="Log ikke ud endnu — ændringer der ikke er sendt, forsvinder når den lokale data ryddes."
          />
        )}

        <button
          className="btn btn-danger btn-block"
          type="button"
          onClick={async () => {
            if (
              status.pending > 0 &&
              !confirm(
                `Der er ${status.pending} ændringer der ikke er sendt endnu. De går tabt. Log ud alligevel?`,
              )
            ) {
              return;
            }
            await signOut();
          }}
        >
          Log ud
        </button>
      </div>
    </main>
  );
}
