import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { bootTestServer, getJson, type TestServer } from "./helpers.js";

describe("app-skallen", () => {
  let server: TestServer;

  before(async () => {
    server = await bootTestServer();
  });

  after(async () => {
    await server.close();
  });

  it("svarer på health", async () => {
    const response = await getJson(`${server.baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "ok" });
  });

  it("giver 404 med en fejlkode klienten kan oversætte", async () => {
    const response = await getJson(`${server.baseUrl}/api/findes-ikke`);
    assert.equal(response.status, 404);
    // Koden er kontrakten. Teksten er kun fallback for klienter der ikke
    // kender koden, så den må gerne ændre sig.
    const body = response.body as { error: { code: string; message: string } };
    assert.equal(body.error.code, "not_found");
    assert.ok(body.error.message.length > 0);
  });

  it("har kørt migrations mod temp-databasen", async () => {
    const { db } = await import("../src/db/client.js");
    const { player } = await import("../src/db/schema.js");
    // Tabellen findes og er tom — beviser at migrationen kørte mod temp-filen.
    assert.deepEqual(await db.select().from(player).all(), []);
  });
});
