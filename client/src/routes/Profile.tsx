import { Link } from "react-router";
import { Empty, ScreenHead } from "../components.js";
import { formatDate, formatTime } from "../format.js";
import { sync } from "../db/sync.js";
import { LANGUAGES, LANGUAGE_NAMES, useLanguage } from "../i18n/index.js";
import { useSession, useSyncStatus, useUser } from "../session.js";
import { APP_BUILT_AT, APP_COMMIT, APP_VERSION } from "../version.js";

export function ProfileScreen() {
  const user = useUser();
  const { signOut } = useSession();
  const status = useSyncStatus();
  const { language, setLanguage, t } = useLanguage();

  return (
    <main className="screen">
      <ScreenHead title={t("profile.title")} />

      <div className="screen-body">
        <div className="stack-tight">
          <h1>{user.name}</h1>
          <span className="lede">{user.email}</span>
          {user.role === "admin" && <span className="tag tag-accent">{t("profile.administrator")}</span>}
        </div>

        <hr className="rule" />

        <section className="stack-tight">
          <h2>{t("profile.sync")}</h2>
          <div className="card card-flat">
            <div className="spread">
              <span className="name">{t(`sync.${status.state}`)}</span>
              {status.pending > 0 && (
                <span className="kicker">
                  {t("banner.queued", { count: status.pending })}
                </span>
              )}
            </div>
            <span className="lede">
              {status.lastSyncedAt
                ? t("profile.lastSynced", {
                    date: formatDate(status.lastSyncedAt),
                    time: formatTime(status.lastSyncedAt),
                  })
                : t("profile.neverSynced")}
            </span>
          </div>
          <button className="btn btn-secondary btn-block" type="button" onClick={() => void sync()}>
            {t("profile.syncNow")}
          </button>
        </section>

        {user.role === "admin" && (
          <>
            <hr className="rule" />
            <section className="stack-tight">
              <h2>{t("profile.administration")}</h2>
              <Link className="btn btn-secondary btn-block" to="/invite-keys">
                {t("profile.inviteKeys")}
              </Link>
            </section>
          </>
        )}

        <hr className="rule" />

        <section className="stack-tight">
          <h2>{t("profile.language")}</h2>
          <div className="seg" role="group" aria-label={t("profile.language")}>
            {LANGUAGES.map((option) => (
              <button
                key={option}
                className="seg-opt"
                type="button"
                lang={option}
                aria-pressed={language === option}
                onClick={() => setLanguage(option)}
              >
                {LANGUAGE_NAMES[option]}
              </button>
            ))}
          </div>
        </section>

        <hr className="rule" />

        {status.pending > 0 && (
          <Empty title={t("profile.queuedTitle")} body={t("profile.queuedBody")} />
        )}

        <section className="stack-tight">
          <h2>{t("profile.version")}</h2>
          <div className="card card-flat">
            <div className="spread">
              <span className="name">{APP_VERSION}</span>
              {APP_COMMIT && <span className="kicker">{APP_COMMIT}</span>}
            </div>
            <span className="lede">
              {APP_BUILT_AT
                ? t("profile.built", {
                    date: formatDate(APP_BUILT_AT),
                    time: formatTime(APP_BUILT_AT),
                  })
                : t("profile.builtUnknown")}
            </span>
          </div>
          {/* Det er bygningen der kører her i browseren — ikke nødvendigvis den
              der ligger på serveren. Service worker'en spørger før den skifter. */}
          <span className="lede">{t("profile.versionHint")}</span>
        </section>

        <hr className="rule" />

        <button
          className="btn btn-danger btn-block"
          type="button"
          onClick={async () => {
            if (
              status.pending > 0 &&
              !confirm(t("profile.signOutConfirm", { count: status.pending }))
            ) {
              return;
            }
            await signOut();
          }}
        >
          {t("profile.signOut")}
        </button>
      </div>
    </main>
  );
}
