import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Loading } from "./components.js";
import { dismissRejections, startSyncLoop, sync } from "./db/sync.js";
import { useT } from "./i18n/index.js";
import { useSession, useSyncStatus } from "./session.js";
import { GamesScreen } from "./routes/Games.js";
import { GroupScreen } from "./routes/Group.js";
import { GroupsScreen } from "./routes/Groups.js";
import { HomeScreen } from "./routes/Home.js";
import { InvitesScreen } from "./routes/Invites.js";
import { LoginScreen } from "./routes/Login.js";
import { NewPlayScreen } from "./routes/NewPlay.js";
import { PlayScreen } from "./routes/Play.js";
import { ProfileScreen } from "./routes/Profile.js";
import { StatsScreen } from "./routes/Stats.js";

function UpdateBanner() {
  const t = useT();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  if (!needRefresh) return null;
  return (
    <div className="banner banner-accent">
      <span className="grow">{t("banner.updateReady")}</span>
      <button type="button" onClick={() => void updateServiceWorker(true)}>
        {t("banner.reload")}
      </button>
    </div>
  );
}

function SyncBanner() {
  const t = useT();
  const status = useSyncStatus();
  const { setUser } = useSession();

  if (status.rejected > 0) {
    return (
      <div className="banner banner-accent">
        <span className="grow">{t.count("banner.rejected", status.rejected)}</span>
        <button type="button" onClick={() => void dismissRejections()}>
          {t("action.ok")}
        </button>
      </div>
    );
  }

  if (status.state === "needsReauth") {
    return (
      <div className="banner banner-accent">
        <span className="grow">{t("banner.sessionExpired")}</span>
        <button type="button" onClick={() => setUser(null)}>
          {t("banner.signIn")}
        </button>
      </div>
    );
  }

  if (status.state === "offline") {
    return (
      <div className="banner">
        <span className="grow">{t("banner.offline")}</span>
        {status.pending > 0 && (
          <span className="kicker">{t("banner.queued", { count: status.pending })}</span>
        )}
      </div>
    );
  }

  if (status.pending > 0) {
    return (
      <div className="banner">
        <span className="grow">{t("banner.sending", { count: status.pending })}</span>
      </div>
    );
  }

  return null;
}

function TabBar() {
  const t = useT();
  const tabs = [
    { to: "/", label: t("nav.home") },
    { to: "/groups", label: t("nav.groups") },
    { to: "/games", label: t("nav.games") },
    { to: "/profile", label: t("nav.profile") },
  ];
  return (
    <nav className="tabbar" aria-label={t("nav.menu")}>
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.to === "/"} className="tab">
          {({ isActive }) => (
            <>
              <span className="tab-mark" style={{ opacity: isActive ? 1 : 0 }} />
              {tab.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function App() {
  const { user, ready } = useSession();
  const location = useLocation();

  // Afhænger kun af bruger-id'et. Sætter man en tilstandsvariabel inde i
  // effekten for at "kun starte én gang", river oprydningen loopet ned igen
  // med det samme, og så lytter ingen længere på online-eventet.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    return startSyncLoop();
  }, [userId]);

  // Ny lokal ændring skal afsted hurtigt, ikke først ved næste tick.
  useEffect(() => {
    if (user) void sync();
  }, [user, location.pathname]);

  if (!ready && !user) {
    return (
      <div className="app">
        <div className="screen-body">
          <Loading />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app">
        <UpdateBanner />
        <Routes>
          <Route path="*" element={<LoginScreen />} />
        </Routes>
      </div>
    );
  }

  // Registreringsflowet fylder skærmen selv og skal ikke have bundnavigation.
  const fullscreen = location.pathname.startsWith("/plays/new");

  return (
    <div className="app">
      <UpdateBanner />
      <SyncBanner />
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/groups" element={<GroupsScreen />} />
        <Route path="/groups/:groupId" element={<GroupScreen />} />
        <Route path="/groups/:groupId/stats" element={<StatsScreen />} />
        <Route path="/plays/new" element={<NewPlayScreen />} />
        <Route path="/plays/new/:groupId" element={<NewPlayScreen />} />
        <Route path="/plays/:playId" element={<PlayScreen />} />
        <Route path="/games" element={<GamesScreen />} />
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="/invite-keys" element={<InvitesScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!fullscreen && <TabBar />}
    </div>
  );
}
