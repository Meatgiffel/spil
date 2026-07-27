import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { bootTestServer, getJson, type TestServer } from "./helpers.js";

type Json = Record<string, unknown>;

let server: TestServer;

function post(path: string, body: unknown, cookie?: string) {
  return getJson(`${server.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function postRaw(path: string, body: unknown) {
  return fetch(`${server.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cookieFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

describe("auth og invitationsnøgler", () => {
  before(async () => {
    server = await bootTestServer();
  });

  after(async () => {
    await server.close();
  });

  let adminCookie = "";

  it("melder at installationen mangler opsætning", async () => {
    const response = await getJson(`${server.baseUrl}/api/auth-status`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { needsSetup: true });
  });

  it("opretter første bruger som admin uden nøgle", async () => {
    const response = await fetch(`${server.baseUrl}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "casper@example.com",
        name: "Casper",
        password: "et-langt-kodeord",
      }),
    });
    assert.equal(response.status, 200);
    adminCookie = cookieFrom(response.headers);
    assert.ok(adminCookie.length > 0, "der skulle være sat en session-cookie");

    const status = await getJson(`${server.baseUrl}/api/auth-status`);
    assert.deepEqual(status.body, { needsSetup: false });
  });

  it("giver den første bruger admin-rollen", async () => {
    const response = await getJson(`${server.baseUrl}/api/invites`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((response.body as Json).inviteKeys, []);
  });

  it("afviser oprettelse uden nøgle når der findes brugere", async () => {
    const response = await post("/api/signup", {
      email: "ny@example.com",
      name: "Ny",
      password: "et-langt-kodeord",
    });
    assert.equal(response.status, 400);
    const fields = ((response.body as Json).error as Json).fields as Json;
    assert.ok(fields.inviteKey, "inviteKey skulle være markeret som fejl");
  });

  it("afviser en opdigtet nøgle", async () => {
    const response = await post("/api/signup", {
      email: "ny@example.com",
      name: "Ny",
      password: "et-langt-kodeord",
      inviteKey: "abcd-efgh-ijkm",
    });
    assert.equal(response.status, 400);
    assert.equal(
      ((response.body as Json).error as Json).message,
      "Invitationsnøglen er ikke gyldig.",
    );
  });

  it("blokerer Better Auths eget sign-up-endpoint", async () => {
    const response = await post("/api/auth/sign-up/email", {
      email: "omgaaelse@example.com",
      name: "Omgåelse",
      password: "et-langt-kodeord",
    });
    assert.equal(response.status, 400);
    assert.match(
      String(((response.body as Json).error as Json).message),
      /invitationsnøglen kontrolleres/i,
    );
  });

  it("lader en admin udstede en nøgle der kan bruges én gang", async () => {
    const created = await post("/api/invites", { label: "Til Mette" }, adminCookie);
    assert.equal(created.status, 201);
    const key = ((created.body as Json).inviteKey as Json).key as string;
    assert.match(key, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);

    const first = await post("/api/signup", {
      email: "mette@example.com",
      name: "Mette",
      password: "et-langt-kodeord",
      inviteKey: key,
    });
    assert.equal(first.status, 200);

    // Samme nøgle må ikke kunne bruges igen.
    const second = await post("/api/signup", {
      email: "anden@example.com",
      name: "Anden",
      password: "et-langt-kodeord",
      inviteKey: key,
    });
    assert.equal(second.status, 400);
  });

  it("afviser en tilbagekaldt nøgle", async () => {
    const created = await post("/api/invites", { maxUses: 5 }, adminCookie);
    const invite = (created.body as Json).inviteKey as Json;
    await post(`/api/invites/${invite.id}/revoke`, {}, adminCookie);

    const response = await post("/api/signup", {
      email: "tilbagekaldt@example.com",
      name: "Test",
      password: "et-langt-kodeord",
      inviteKey: invite.key as string,
    });
    assert.equal(response.status, 400);
  });

  it("afviser en udløbet nøgle", async () => {
    const created = await post(
      "/api/invites",
      { expiresAt: Date.now() - 1000 },
      adminCookie,
    );
    const invite = (created.body as Json).inviteKey as Json;

    const response = await post("/api/signup", {
      email: "udloebet@example.com",
      name: "Test",
      password: "et-langt-kodeord",
      inviteKey: invite.key as string,
    });
    assert.equal(response.status, 400);
  });

  it("brænder ikke nøglen når e-mailen allerede er taget", async () => {
    const created = await post("/api/invites", {}, adminCookie);
    const invite = (created.body as Json).inviteKey as Json;

    const taken = await post("/api/signup", {
      email: "mette@example.com",
      name: "Dublet",
      password: "et-langt-kodeord",
      inviteKey: invite.key as string,
    });
    assert.equal(taken.status, 400);

    // Nøglen skal stadig virke til en ny e-mail.
    const ok = await post("/api/signup", {
      email: "frisk@example.com",
      name: "Frisk",
      password: "et-langt-kodeord",
      inviteKey: invite.key as string,
    });
    assert.equal(ok.status, 200);
  });

  it("accepterer et kort kodeord på 6 tegn", async () => {
    const created = await post("/api/invites", {}, adminCookie);
    const invite = (created.body as Json).inviteKey as Json;

    const response = await post("/api/signup", {
      email: "kort@example.com",
      name: "Kort",
      password: "abcdef",
      inviteKey: invite.key as string,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  });

  it("afviser stadig et kodeord på under 6 tegn", async () => {
    const created = await post("/api/invites", {}, adminCookie);
    const invite = (created.body as Json).inviteKey as Json;

    const response = await post("/api/signup", {
      email: "kortere@example.com",
      name: "Kortere",
      password: "abcde",
      inviteKey: invite.key as string,
    });
    assert.equal(response.status, 400);
    const fields = ((response.body as Json).error as Json).fields as Json;
    assert.match(String(fields.password), /mindst 6 tegn/);
  });

  it("nægter en almindelig bruger adgang til nøgleadministration", async () => {
    const login = await postRaw("/api/auth/sign-in/email", {
      email: "mette@example.com",
      password: "et-langt-kodeord",
    });
    assert.equal(login.status, 200);
    const memberCookie = cookieFrom(login.headers);

    const response = await getJson(`${server.baseUrl}/api/invites`, {
      headers: { cookie: memberCookie },
    });
    assert.equal(response.status, 403);
  });

  it("opretter en spiller til hver ny konto", async () => {
    const { db } = await import("../src/db/client.js");
    const { player } = await import("../src/db/schema.js");
    const players = await db.select().from(player).all();
    const names = players.map((row) => row.name).sort();
    assert.deepEqual(names, ["Casper", "Frisk", "Kort", "Mette"]);
    assert.ok(
      players.every((row) => row.userId !== null),
      "spillere oprettet ved signup skal være koblet til kontoen",
    );
  });
});
