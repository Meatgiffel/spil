import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { v7 as uuidv7 } from "uuid";
import type { Mutation, MutationResult, SyncTable } from "@spil/shared";
import { bootTestServer, createAccount, type TestServer } from "./helpers.js";

let server: TestServer;

type PushBody = { results: MutationResult[]; cursor: number };
type PullBody = { cursor: number; changes: Record<SyncTable, Record<string, unknown>[]> };

function upsert(
  table: SyncTable,
  payload: Record<string, unknown>,
  updatedAt: number,
): Mutation {
  return {
    opId: uuidv7(),
    table,
    id: payload.id as string,
    op: "upsert",
    updatedAt,
    payload,
  };
}

function remove(table: SyncTable, id: string, updatedAt: number): Mutation {
  return { opId: uuidv7(), table, id, op: "delete", updatedAt, payload: null };
}

async function push(cookie: string, mutations: Mutation[]): Promise<PushBody> {
  const response = await fetch(`${server.baseUrl}/api/sync/push`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ mutations }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()) as PushBody;
}

async function pull(cookie: string, since = 0): Promise<PullBody> {
  const response = await fetch(`${server.baseUrl}/api/sync/pull`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ since }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()) as PullBody;
}

function statuses(body: PushBody): string[] {
  return body.results.map((result) => result.status);
}

describe("sync", () => {
  // Faste tidsstempler i fortiden, så last-write-wins kan styres præcist.
  const t0 = Date.now() - 100_000;

  let anna: Awaited<ReturnType<typeof createAccount>>;
  let bo: Awaited<ReturnType<typeof createAccount>>;
  let carl: Awaited<ReturnType<typeof createAccount>>;

  const groupId = uuidv7();
  const gameId = uuidv7();
  const playId = uuidv7();

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
  });

  after(async () => {
    await server.close();
  });

  it("lader en bruger oprette en gruppe og sig selv som medlem i én push", async () => {
    // Det her er formen en offline-oprettelse har: gruppen og medlemskabet
    // ankommer sammen, og brugeren er ikke medlem endnu når gruppen skrives.
    const body = await push(anna.cookie, [
      upsert("groupMember", {
        id: uuidv7(),
        groupId,
        playerId: anna.playerId,
        role: "owner",
      }, t0),
      upsert("group", { id: groupId, name: "Spilklubben" }, t0),
    ]);
    assert.deepEqual(statuses(body), ["applied", "applied"]);
  });

  it("viser gruppen for medlemmet og skjuler den for alle andre", async () => {
    const mine = await pull(anna.cookie);
    assert.deepEqual(
      mine.changes.group.map((row) => row.name),
      ["Spilklubben"],
    );

    const andres = await pull(bo.cookie);
    assert.deepEqual(andres.changes.group, []);
    assert.deepEqual(andres.changes.groupMember, []);
  });

  it("afviser at en udenforstående skriver i gruppen", async () => {
    const body = await push(bo.cookie, [
      upsert("play", {
        id: uuidv7(),
        groupId,
        gameId,
        playedAt: t0,
      }, t0),
    ]);
    assert.deepEqual(statuses(body), ["rejected"]);
    assert.match(String(body.results[0]!.message), /ikke medlem/i);
  });

  it("afviser at nogen kaprer en tom gruppe de ikke har oprettet", async () => {
    const fremmedGruppe = uuidv7();
    await push(anna.cookie, [upsert("group", { id: fremmedGruppe, name: "Annas" }, t0)]);

    const body = await push(bo.cookie, [
      upsert("groupMember", {
        id: uuidv7(),
        groupId: fremmedGruppe,
        playerId: bo.playerId,
        role: "owner",
      }, t0),
    ]);
    assert.deepEqual(statuses(body), ["rejected"]);
  });

  it("giver adgang når medlemmet er tilføjet", async () => {
    await push(anna.cookie, [
      upsert("groupMember", {
        id: uuidv7(),
        groupId,
        playerId: bo.playerId,
        role: "member",
      }, t0 + 1),
    ]);

    const bos = await pull(bo.cookie);
    assert.deepEqual(
      bos.changes.group.map((row) => row.name),
      ["Spilklubben"],
    );
    // Bo ser nu også Annas spiller, fordi de deler gruppe.
    const navne = bos.changes.player.map((row) => row.name).sort();
    assert.deepEqual(navne, ["Anna", "Bo"]);
    // Carl deler ingen gruppe med dem og må ikke dukke op.
    assert.ok(!navne.includes("Carl"));
  });

  it("registrerer et parti med placeringer", async () => {
    const body = await push(anna.cookie, [
      upsert("game", { id: gameId, title: "Vingespil", year: 2019 }, t0),
      upsert("play", {
        id: playId,
        groupId,
        gameId,
        playedAt: t0,
        location: "Hjemme hos Anna",
        durationMinutes: 75,
      }, t0),
      upsert("playParticipant", {
        id: uuidv7(),
        playId,
        playerId: anna.playerId,
        placement: 1,
      }, t0),
      upsert("playParticipant", {
        id: uuidv7(),
        playId,
        playerId: bo.playerId,
        placement: 2,
      }, t0),
    ]);
    assert.deepEqual(statuses(body), ["applied", "applied", "applied", "applied"]);

    const bos = await pull(bo.cookie);
    assert.equal(bos.changes.play.length, 1);
    assert.equal(bos.changes.playParticipant.length, 2);
  });

  it("lader gæstespillere uden konto være med", async () => {
    const gaestId = uuidv7();
    const body = await push(anna.cookie, [
      upsert("player", { id: gaestId, name: "Mormor", userId: null }, t0 + 2),
      upsert("groupMember", {
        id: uuidv7(),
        groupId,
        playerId: gaestId,
        role: "member",
      }, t0 + 2),
    ]);
    assert.deepEqual(statuses(body), ["applied", "applied"]);

    const bos = await pull(bo.cookie);
    assert.ok(bos.changes.player.some((row) => row.name === "Mormor"));
  });

  it("nægter at knytte en spiller til en anden konto", async () => {
    const body = await push(bo.cookie, [
      upsert("player", { id: uuidv7(), name: "Falsk Anna", userId: anna.userId }, t0 + 3),
    ]);
    assert.deepEqual(statuses(body), ["rejected"]);
  });

  it("afgør konflikter med last-write-wins", async () => {
    // Bo retter først, Anna bagefter — men Bos push ankommer sidst.
    const annas = await push(anna.cookie, [
      upsert("play", {
        id: playId,
        groupId,
        gameId,
        playedAt: t0,
        location: "Annas version",
      }, t0 + 100),
    ]);
    assert.deepEqual(statuses(annas), ["applied"]);

    const bos = await push(bo.cookie, [
      upsert("play", {
        id: playId,
        groupId,
        gameId,
        playedAt: t0,
        location: "Bos version",
      }, t0 + 50),
    ]);
    assert.deepEqual(statuses(bos), ["stale"]);

    const efter = await pull(anna.cookie);
    const parti = efter.changes.play.find((row) => row.id === playId);
    assert.equal(parti?.location, "Annas version");
  });

  it("er idempotent på opId", async () => {
    const mutation = upsert("play", {
      id: playId,
      groupId,
      gameId,
      playedAt: t0,
      location: "Gentaget",
    }, t0 + 200);

    assert.deepEqual(statuses(await push(anna.cookie, [mutation])), ["applied"]);
    // Samme opId igen — fx efter en timeout hvor svaret aldrig nåede frem.
    assert.deepEqual(statuses(await push(anna.cookie, [mutation])), ["duplicate"]);
  });

  it("propagerer sletning som soft delete", async () => {
    const foer = await pull(bo.cookie);
    const cursor = foer.cursor;

    await push(anna.cookie, [remove("play", playId, t0 + 300)]);

    const efter = await pull(bo.cookie, cursor);
    const slettet = efter.changes.play.find((row) => row.id === playId);
    assert.ok(slettet, "sletningen skal komme med i pull");
    assert.ok(
      typeof slettet.deletedAt === "number",
      "rækken skal have deletedAt sat, ikke være væk",
    );
  });

  it("lader afviste mutationer stå alene uden at vælte resten af batchen", async () => {
    const okId = uuidv7();
    const body = await push(anna.cookie, [
      upsert("game", { id: okId, title: "Carcassonne" }, t0 + 400),
      upsert("player", { id: uuidv7(), name: "Kapret", userId: bo.userId }, t0 + 400),
    ]);
    assert.deepEqual(statuses(body), ["applied", "rejected"]);

    const efter = await pull(anna.cookie);
    assert.ok(efter.changes.game.some((row) => row.id === okId));
  });

  it("giver kun ændringer siden cursoren", async () => {
    const foerste = await pull(anna.cookie);
    const tomt = await pull(anna.cookie, foerste.cursor);
    for (const rows of Object.values(tomt.changes)) {
      assert.deepEqual(rows, []);
    }
  });

  it("kræver login", async () => {
    const response = await fetch(`${server.baseUrl}/api/sync/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ since: 0 }),
    });
    assert.equal(response.status, 401);
  });
});
