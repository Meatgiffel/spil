export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Sat når serveren har svaret 401. Blokerer ikke lokal læsning eller skrivning. */
export class NotLoggedInError extends ApiError {
  constructor(message = "Din session er udløbet.") {
    super(401, message);
    this.name = "NotLoggedInError";
  }
}

type ErrorBody = { error?: { message?: string; fields?: Record<string, string> } };

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
    throw new ApiError(0, "Ingen forbindelse.");
  }

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const errorBody = body as ErrorBody | null;
    const message = errorBody?.error?.message ?? "Der gik noget galt.";
    if (response.status === 401) throw new NotLoggedInError(message);
    throw new ApiError(response.status, message, errorBody?.error?.fields);
  }

  return body as T;
}

export const post = <T>(path: string, payload: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}) });
