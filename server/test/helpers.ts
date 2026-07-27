import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Express } from "express";

// Tests booter den rigtige Express-app mod en temp-SQLite. Env-variablerne sættes
// her, før noget importeres — env.ts læser dem ved import. Ingen .env skal findes.
export type TestServer = {
  baseUrl: string;
  app: Express;
  dir: string;
  close: () => Promise<void>;
};

export async function bootTestServer(): Promise<TestServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "spil-test-"));

  process.env.NODE_ENV = "test";
  process.env.DATABASE_PATH = path.join(dir, "test.db");
  process.env.UPLOADS_DIR = path.join(dir, "uploads");
  process.env.BETTER_AUTH_SECRET = "test-hemmelighed-der-er-lang-nok-1234567890";
  process.env.PUBLIC_URL = "http://localhost:5173";
  process.env.TRUSTED_ORIGINS = "http://localhost:5173";

  const { runMigrations } = await import("../src/db/migrate.js");
  runMigrations();

  const { app } = await import("../src/app.js");

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    app,
    dir,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function cookieFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

/** Opretter en konto og returnerer sessionscookien plus bruger- og spiller-id. */
export async function createAccount(
  server: TestServer,
  input: { email: string; name: string; password?: string; inviteKey?: string },
): Promise<{ cookie: string; userId: string; playerId: string }> {
  const response = await fetch(`${server.baseUrl}/api/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      name: input.name,
      password: input.password ?? "et-langt-kodeord",
      ...(input.inviteKey ? { inviteKey: input.inviteKey } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Kunne ikke oprette ${input.email}: ${await response.text()}`);
  }
  const body = (await response.json()) as { user: { id: string } };
  const { db } = await import("../src/db/client.js");
  const { player } = await import("../src/db/schema.js");
  const { eq } = await import("drizzle-orm");
  const row = db.select().from(player).where(eq(player.userId, body.user.id)).get();
  if (!row) throw new Error("Der blev ikke oprettet en spiller til kontoen.");
  return { cookie: cookieFrom(response.headers), userId: body.user.id, playerId: row.id };
}

export async function getJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? (JSON.parse(text) as unknown) : null,
  };
}
