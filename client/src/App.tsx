import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Loading } from "./components.js";
import { dismissRejections, startSyncLoop, sync } from "./db/sync.js";
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
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  if (!needRefresh) return null;
  return (
    <div className="banner banner-accent">
      <span className="grow">Ny version klar.</span>
      <button type="button" onClick={() => void updateServiceWorker(true)}>
        Genindlæs
      </button>
    </div>
  );
}

function SyncBanner() {
  const status = useSyncStatus();
  const { setUser } = useSession();

  if (status.rejected > 0) {
    return (
      <div className="banner banner-accent">
        <span className="grow">
          {status.rejected === 1
            ? "1 ændring blev afvist af serveren."
            : `${status.rejected} ændringer blev afvist af serveren.`}
        </span>
        <button type="button" onClick={() => void dismissRejections()}>
          OK
        </button>
      </div>
    );
  }

  if (status.state === "needsReauth") {
    return (
      <div className="banner banner-accent">
        <span className="grow">Din session er udløbet.</span>
        <button type="button" onClick={() => setUser(null)}>
          Log ind
        </button>
      </div>
    );
  }

  if (status.state === "offline") {
    return (
      <div className="banner">
        <span className="grow">Offline — alt du laver bliver gemt.</span>
        {status.pending > 0 && <span className="kicker">{status.pending} i kø</span>}
      </div>
    );
  }

  if (status.pending > 0) {
    return (
      <div className="banner">
        <span className="grow">{status.pending} ændringer sendes…</span>
      </div>
    );
  }

  return null;
}

function TabBar() {
  const tabs = [
    { to: "/", label: "Hjem" },
    { to: "/grupper", label: "Grupper" },
    { to: "/spil", label: "Spil" },
    { to: "/profil", label: "Profil" },
  ];
  return (
    <nav className="tabbar" aria-label="Hovedmenu">
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
  const fullscreen = location.pathname.startsWith("/nyt-parti");

  return (
    <div className="app">
      <UpdateBanner />
      <SyncBanner />
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/grupper" element={<GroupsScreen />} />
        <Route path="/grupper/:groupId" element={<GroupScreen />} />
        <Route path="/grupper/:groupId/statistik" element={<StatsScreen />} />
        <Route path="/nyt-parti" element={<NewPlayScreen />} />
        <Route path="/nyt-parti/:groupId" element={<NewPlayScreen />} />
        <Route path="/partier/:playId" element={<PlayScreen />} />
        <Route path="/spil" element={<GamesScreen />} />
        <Route path="/profil" element={<ProfileScreen />} />
        <Route path="/noegler" element={<InvitesScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!fullscreen && <TabBar />}
    </div>
  );
}
