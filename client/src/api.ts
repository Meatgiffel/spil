export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Stabil fejlkode fra serveren. Klienten oversætter den. */
    readonly code: string,
    message: string,
    /** Feltnavn → fejlkode. */
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Sat når serveren har svaret 401. Blokerer ikke lokal læsning eller skrivning. */
export class NotLoggedInError extends ApiError {
  constructor(message = "Session expired.") {
    super(401, "session_expired", message);
    this.name = "NotLoggedInError";
  }
}

type ErrorBody = {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    // Netværksfejl er den normale tilstand i en offline-first app, ikke en undtagelse.
    throw new ApiError(0, "no_connection", "No connection.");
  }

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const errorBody = body as ErrorBody | null;
    const code = errorBody?.error?.code ?? "unknown";
    const message = errorBody?.error?.message ?? "Something went wrong.";
    if (response.status === 401) throw new NotLoggedInError(message);
    throw new ApiError(response.status, code, message, errorBody?.error?.fields);
  }

  return body as T;
}

export const post = <T>(path: string, payload: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}) });
