import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { bootTestServer, createAccount, type TestServer } from "./helpers.js";

/**
 * BoardGameGeek lukkede XML API'et bag registrering og bearer-tokens i
 * efteråret 2025. Uden token svarer de 401 på alt.
 *
 * De her tests dækker adfærden når tokenet mangler — det er den tilstand
 * installationen står i indtil man har registreret sig, og den må ikke gøre
 * resten af spilbiblioteket ubrugeligt.
 */
describe("BoardGameGeek uden API-token", () => {
  let server: TestServer;
  let cookie: string;

  before(async () => {
    server = await bootTestServer();
    const account = await createAccount(server, {
      email: "anna@example.com",
      name: "Anna",
    });
    cookie = account.cookie;
  });

  after(async () => {
    await server.close();
  });

  it("melder at opslag ikke er sat op", async () => {
    const response = await fetch(`${server.baseUrl}/api/games/bgg-status`, {
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { configured: false });
  });

  it("svarer 501 på søgning, ikke 503", async () => {
    // 503 ville betyde "prøv igen om lidt". Ingen ventetid løser et manglende
    // token, så beskeden skal pege på den rigtige årsag.
    const response = await fetch(`${server.baseUrl}/api/games/search?q=wingspan`, {
      headers: { cookie },
    });
    assert.equal(response.status, 501);
    const body = (await response.json()) as { error: { message: string } };
    assert.match(body.error.message, /ikke sat op|API-token/i);
  });

  it("svarer 501 på import", async () => {
    const response = await fetch(`${server.baseUrl}/api/games/import`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ bggId: 266192 }),
    });
    assert.equal(response.status, 501);
  });

  it("blokerer ikke resten af biblioteket", async () => {
    // Manuel oprettelse går gennem sync og rører aldrig BGG.
    const { v7: uuidv7 } = await import("uuid");
    const id = uuidv7();
    const response = await fetch(`${server.baseUrl}/api/sync/push`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        mutations: [
          {
            opId: uuidv7(),
            table: "game",
            id,
            op: "upsert",
            updatedAt: Date.now(),
            payload: { id, title: "Vingespil" },
          },
        ],
      }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { results: { status: string }[] };
    assert.equal(body.results[0]!.status, "applied");
  });
});
