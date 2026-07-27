import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { v7 as uuidv7 } from "uuid";
import type { Mutation, SyncTable } from "@spil/shared";
import { bootTestServer, createAccount, type TestServer } from "./helpers.js";

let server: TestServer;

function upsert(table: SyncTable, payload: Record<string, unknown>, at: number): Mutation {
  return {
    opId: uuidv7(),
    table,
    id: payload.id as string,
    op: "upsert",
    updatedAt: at,
    payload,
  };
}

async function push(cookie: string, mutations: Mutation[]) {
  const response = await fetch(`${server.baseUrl}/api/sync/push`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ mutations }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()) as { results: { status: string }[] };
}

async function pull(cookie: string, since = 0) {
  const response = await fetch(`${server.baseUrl}/api/sync/pull`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ since }),
  });
  return (await response.json()) as {
    cursor: number;
    changes: Record<SyncTable, Record<string, unknown>[]>;
  };
}

function link(cookie: string, guestId: string, targetPlayerId: string) {
  return fetch(`${server.baseUrl}/api/players/${guestId}/link`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ targetPlayerId }),
  });
}

describe("kobling af gæst til konto", () => {
  const t0 = Date.now() - 100_000;

  let anna: Awaited<ReturnType<typeof createAccount>>;
  let bo: Awaited<ReturnType<typeof createAccount>>;
  let carl: Awaited<ReturnType<typeof createAccount>>;

  const groupId = uuidv7();
  const gameId = uuidv7();

  before(async () => {
    server = await bootTestServer();
    anna = await createAccount(server, { email: "anna@example.com", name: "Anna" });

    const invite = async () => {
      const response = await fetch(`${server.baseUrl}/api/invites`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: anna.cookie },
        body: JSON.stringify({ maxUses: 1 }),
      });
      const body = (await response.json()) as { inviteKey: { key: string } };
      return body.inviteKey.key;
    };

    bo = await createAccount(server, {
      email: "bo@example.com",
      name: "Bo",
      inviteKey: await invite(),
    });
    carl = await createAccount(server, {
      email: "carl@example.com",
      name: "Carl",
      inviteKey: await invite(),
    });

    // Annas gruppe med hende selv.
    const membership = uuidv7();
    await push(anna.cookie, [
      upsert("group", { id: groupId, name: "Spilklubben" }, t0),
      upsert(
        "groupMember",
        { id: membership, groupId, playerId: anna.playerId, role: "owner" },
        t0,
      ),
      upsert("game", { id: gameId, title: "Vingespil" }, t0),
    ]);
  });

  after(async () => {
    await server.close();
  });

  it("viser konti man kan tilføje", async () => {
    const response = await fetch(`${server.baseUrl}/api/players/accounts`, {
      headers: { cookie: anna.cookie },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      accounts: { playerId: string; name: string; email: string }[];
    };
    // Alle tre konti, også dem man ikke deler gruppe med — det er hele pointen.
    assert.deepEqual(
      body.accounts.map((row) => row.name).sort(),
      ["Anna", "Bo", "Carl"],
    );
    assert.ok(body.accounts.every((row) => row.playerId && row.email));
  });

  it("kræver login", async () => {
    const response = await fetch(`${server.baseUrl}/api/players/accounts`);
    assert.equal(response.status, 401);
  });

  it("flytter gæstens partier og medlemskab over på kontoen", async () => {
    const guestId = uuidv7();
    const playId = uuidv7();

    await push(anna.cookie, [
      upsert("player", { id: guestId, name: "Bo (gæst)", userId: null }, t0 + 1),
      upsert(
        "groupMember",
        { id: uuidv7(), groupId, playerId: guestId, role: "member" },
        t0 + 1,
      ),
      upsert("play", { id: playId, groupId, gameId, playedAt: t0 }, t0 + 1),
      upsert(
        "playParticipant",
        { id: uuidv7(), playId, playerId: guestId, placement: 1 },
        t0 + 1,
      ),
      upsert(
        "playParticipant",
        { id: uuidv7(), playId, playerId: anna.playerId, placement: 2 },
        t0 + 1,
      ),
    ]);

    const response = await link(anna.cookie, guestId, bo.playerId);
    assert.equal(response.status, 200, await response.clone().text());

    const efter = await pull(anna.cookie);

    // Gæsten er væk, men som soft delete så klienterne får det at vide.
    const guest = efter.changes.player.find((row) => row.id === guestId);
    assert.ok(guest, "gæsten skal komme med i pull");
    assert.ok(typeof guest.deletedAt === "number");

    // Sejren tilhører nu Bos konto.
    const winner = efter.changes.playParticipant.find(
      (row) => row.playId === playId && row.placement === 1,
    );
    assert.equal(winner?.playerId, bo.playerId, "1. pladsen skulle flytte med");
    assert.equal(winner?.deletedAt, null);

    // Og Bo er medlem af gruppen i gæstens sted.
    const membership = efter.changes.groupMember.find(
      (row) => row.playerId === bo.playerId && row.deletedAt === null,
    );
    assert.ok(membership, "Bo skal være medlem efter koblingen");

    // Bo kan nu selv se gruppen — han styrer den på lige fod med Anna.
    const bos = await pull(bo.cookie);
    assert.deepEqual(
      bos.changes.group.map((row) => row.name),
      ["Spilklubben"],
    );
  });

  it("dubletter i samme parti bliver til én række", async () => {
    // Gæsten og kontoen var begge med i samme parti — det sker når nogen er
    // blevet noteret som gæst i et parti hvor de også deltog med deres konto.
    const guestId = uuidv7();
    const playId = uuidv7();

    await push(anna.cookie, [
      upsert("player", { id: guestId, name: "Carl (gæst)", userId: null }, t0 + 2),
      upsert(
        "groupMember",
        { id: uuidv7(), groupId, playerId: guestId, role: "member" },
        t0 + 2,
      ),
      upsert(
        "groupMember",
        { id: uuidv7(), groupId, playerId: carl.playerId, role: "member" },
        t0 + 2,
      ),
      upsert("play", { id: playId, groupId, gameId, playedAt: t0 }, t0 + 2),
      upsert(
        "playParticipant",
        { id: uuidv7(), playId, playerId: guestId, placement: 2 },
        t0 + 2,
      ),
      upsert(
        "playParticipant",
        { id: uuidv7(), playId, playerId: carl.playerId, placement: 1 },
        t0 + 2,
      ),
    ]);

    const response = await link(anna.cookie, guestId, carl.playerId);
    assert.equal(response.status, 200, await response.clone().text());

    const efter = await pull(anna.cookie);
    const levende = efter.changes.playParticipant.filter(
      (row) => row.playId === playId && row.deletedAt === null,
    );
    // Kun kontoens række overlever — det unikke indeks tillader ikke to.
    assert.equal(levende.length, 1);
    assert.equal(levende[0]!.playerId, carl.playerId);
    assert.equal(levende[0]!.placement, 1, "kontoens egen placering beholdes");
  });

  it("afviser at koble en spiller der allerede har en konto", async () => {
    const response = await link(anna.cookie, bo.playerId, carl.playerId);
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "player_not_guest");
  });

  it("afviser en modtager uden konto", async () => {
    const guestId = uuidv7();
    const andenGaest = uuidv7();
    await push(anna.cookie, [
      upsert("player", { id: guestId, name: "Gæst A", userId: null }, t0 + 3),
      upsert("player", { id: andenGaest, name: "Gæst B", userId: null }, t0 + 3),
    ]);

    const response = await link(anna.cookie, guestId, andenGaest);
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "target_not_account");
  });

  it("nægter at koble en gæst i en gruppe man ikke er med i", async () => {
    const fremmedGruppe = uuidv7();
    const guestId = uuidv7();
    const membership = uuidv7();

    // Bo laver sin egen gruppe med en gæst i.
    await push(bo.cookie, [
      upsert("group", { id: fremmedGruppe, name: "Bos gruppe" }, t0 + 4),
      upsert(
        "groupMember",
        { id: membership, groupId: fremmedGruppe, playerId: bo.playerId, role: "owner" },
        t0 + 4,
      ),
      upsert("player", { id: guestId, name: "Bos gæst", userId: null }, t0 + 4),
      upsert(
        "groupMember",
        { id: uuidv7(), groupId: fremmedGruppe, playerId: guestId, role: "member" },
        t0 + 4,
      ),
    ]);

    // Carl er ikke med i Bos gruppe og må derfor ikke omskrive dens historik.
    const response = await link(carl.cookie, guestId, carl.playerId);
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "link_needs_all_groups");
  });
});
