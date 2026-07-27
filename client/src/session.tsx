import {
  createContext,
  use,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { cachedSession, loadSession, signOut as apiSignOut } from "./auth-client.js";
import { clearLocalData, type CurrentUser } from "./db/local.js";
import { subscribeSync, type SyncStatus } from "./db/sync.js";

type SessionValue = {
  user: CurrentUser | null;
  ready: boolean;
  setUser: (user: CurrentUser | null) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Den cachede bruger vises med det samme, så app'en åbner logget ind uden
      // net. Serveren spørges bagefter og retter hvis sessionen er udløbet.
      const cached = await cachedSession();
      if (!cancelled && cached) setUser(cached);
      const fresh = await loadSession();
      if (!cancelled) {
        setUser(fresh);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut();
    // Lokal data ryddes, så næste bruger på samme enhed ikke ser forrige brugers grupper.
    await clearLocalData();
    setUser(null);
  }, []);

  return (
    <SessionContext value={{ user, ready, setUser, signOut }}>{children}</SessionContext>
  );
}

export function useSession(): SessionValue {
  const value = use(SessionContext);
  if (!value) throw new Error("useSession skal bruges inde i SessionProvider.");
  return value;
}

/** Kaster hvis der ikke er en bruger. Brug kun i skærme bag login. */
export function useUser(): CurrentUser {
  const { user } = useSession();
  if (!user) throw new Error("Der er ingen bruger i sessionen.");
  return user;
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({
    state: "idle",
    lastSyncedAt: null,
    pending: 0,
    rejected: 0,
  });
  useEffect(() => subscribeSync(setStatus), []);
  return status;
}
