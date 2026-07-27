import { api, post } from "./api.js";
import { SESSION_KEY, getMeta, setMeta, type CurrentUser } from "./db/local.js";

type SessionResponse = { user: CurrentUser } | null;

export async function fetchAuthStatus(): Promise<{ needsSetup: boolean }> {
  return api("/api/auth-status");
}

/**
 * Henter sessionen fra serveren og gemmer brugeren lokalt.
 *
 * Uden net falder vi tilbage på den cachede bruger, så app'en åbner direkte i
 * logget-ind-tilstand. Er sessionen udløbet, ryddes cachen.
 */
export async function loadSession(): Promise<CurrentUser | null> {
  try {
    const result = await api<SessionResponse>("/api/auth/get-session");
    const user = result?.user ?? null;
    await setMeta(SESSION_KEY, user);
    return user;
  } catch (error) {
    if (error instanceof Error && error.name === "NotLoggedInError") {
      await setMeta(SESSION_KEY, null);
      return null;
    }
    // Netværksfejl: brug den cachede bruger.
    return getMeta<CurrentUser | null>(SESSION_KEY, null);
  }
}

export function cachedSession(): Promise<CurrentUser | null> {
  return getMeta<CurrentUser | null>(SESSION_KEY, null);
}

export async function signIn(email: string, password: string): Promise<CurrentUser> {
  const result = await post<{ user: CurrentUser }>("/api/auth/sign-in/email", {
    email,
    password,
  });
  await setMeta(SESSION_KEY, result.user);
  return result.user;
}

export async function signUp(input: {
  email: string;
  name: string;
  password: string;
  inviteKey?: string;
}): Promise<CurrentUser> {
  const result = await post<{ user: CurrentUser }>("/api/signup", input);
  await setMeta(SESSION_KEY, result.user);
  return result.user;
}

export async function signOut(): Promise<void> {
  try {
    await post("/api/auth/sign-out", {});
  } finally {
    await setMeta(SESSION_KEY, null);
  }
}
