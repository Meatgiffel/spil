import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { v7 as uuidv7 } from "uuid";
import { bootTestServer, createAccount, type TestServer } from "./helpers.js";

let server: TestServer;

// Et minimalt gyldigt PNG — nok til at komme forbi mimetype-tjekket.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function upload(cookie: string, playId: string, file = PNG, type = "image/png") {
  const form = new FormData();
  form.append("playId", playId);
  form.append("file", new Blob([file], { type }), "billede.png");
  return fetch(`${server.baseUrl}/api/uploads`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
}

describe("upload af billeder", () => {
  let anna: Awaited<ReturnType<typeof createAccount>>;
  let bo: Awaited<ReturnType<typeof createAccount>>;
  const groupId = uuidv7();
  const gameId = uuidv7();
  const playId = uuidv7();
  const memberId = uuidv7();

  before(async () => {
    server = await bootTestServer();
    anna = await createAccount(server, { email: "anna@example.com", name: "Anna" });

    const invite = await fetch(`${server.baseUrl}/api/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: anna.cookie },
      body: JSON.stringify({ maxUses: 1 }),
    });
    const { inviteKey } = (await invite.json()) as { inviteKey: { key: string } };
    bo = await createAccount(server, {
      email: "bo@example.com",
      name: "Bo",
      inviteKey: inviteKey.key,
    });

    const now = Date.now();
    const push = (mutations: unknown[]) =>
      fetch(`${server.baseUrl}/api/sync/push`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: anna.cookie },
        body: JSON.stringify({ mutations }),
      });

    await push([
      {
        opId: uuidv7(),
        table: "group",
        id: groupId,
        op: "upsert",
        updatedAt: now,
        payload: { id: groupId, name: "Spilklubben" },
      },
      {
        opId: uuidv7(),
        table: "groupMember",
        id: memberId,
        op: "upsert",
        updatedAt: now,
        payload: { id: memberId, groupId, playerId: anna.playerId, role: "owner" },
      },
      {
        opId: uuidv7(),
        table: "game",
        id: gameId,
        op: "upsert",
        updatedAt: now,
        payload: { id: gameId, title: "Vingespil" },
      },
      {
        opId: uuidv7(),
        table: "play",
        id: playId,
        op: "upsert",
        updatedAt: now,
        payload: { id: playId, groupId, gameId, playedAt: now },
      },
    ]);
  });

  after(async () => {
    await server.close();
  });

  it("kræver login", async () => {
    const form = new FormData();
    form.append("playId", playId);
    form.append("file", new Blob([PNG], { type: "image/png" }), "billede.png");
    const response = await fetch(`${server.baseUrl}/api/uploads`, {
      method: "POST",
      body: form,
    });
    assert.equal(response.status, 401);
  });

  it("gemmer billedet og serverer det bagefter", async () => {
    const response = await upload(anna.cookie, playId);
    assert.equal(response.status, 201, await response.clone().text());
    const { filePath } = (await response.json()) as { filePath: string };
    assert.match(filePath, /^\/uploads\/plays\/[0-9a-f-]+\.png$/);

    const served = await fetch(`${server.baseUrl}${filePath}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
  });

  it("nægter at uploade til et parti i en gruppe man ikke er med i", async () => {
    // Adgangsgrænsen er gruppen — også for filer, ikke kun for rækker.
    const response = await upload(bo.cookie, playId);
    assert.equal(response.status, 403);
  });

  it("afviser filtyper der ikke er billeder", async () => {
    const response = await upload(
      anna.cookie,
      playId,
      Buffer.from("#!/bin/sh\necho hej\n"),
      "application/x-sh",
    );
    assert.equal(response.status, 400);
  });

  it("afviser et ukendt parti", async () => {
    const response = await upload(anna.cookie, uuidv7());
    assert.equal(response.status, 404);
  });
});
