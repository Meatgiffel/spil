import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mutation } from "@spil/shared";
import {
  CURSOR_KEY,
  clearLocalData,
  db,
  getMeta,
  mutate,
  remove,
  type CurrentUser,
} from "./local.js";
import { sync, syncStatus } from "./sync.js";

const user: CurrentUser = {
  id: "bruger-1",
  email: "anna@example.com",
  name: "Anna",
  role: "user",
};

type PushBody = { mutations: Mutation[] };

/** Sidste push serveren "modtog", så testen kan se hvad klienten sendte. */
let received: Mutation[] = [];

function stubServer(handlers: {
  push?: (mutations: Mutation[]) => { results: unknown[]; serverSeq: number };
  pull?: (since: number) => { cursor: number; changes: Record<string, unknown[]> };
}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as PushBody & { since: number }) : null;

    if (url.endsWith("/api/sync/push")) {
      const mutations = body?.mutations ?? [];
      received = mutations;
      const result = handlers.push
        ? handlers.push(mutations)
        : {
            results: mutations.map((mutation) => ({
              opId: mutation.opId,
              status: "applied",
            })),
            serverSeq: 1,
          };
      return new Response(JSON.stringify(result), { status: 200 });
    }

    if (url.endsWith("/api/sync/pull")) {
      const result = handlers.pull
        ? handlers.pull(body?.since ?? 0)
        : { cursor: 0, changes: {} };
      return new Response(JSON.stringify(result), { status: 200 });
    }

    throw new Error(`Ukendt kald: ${url}`);
  }) as unknown as typeof fetch;
}

describe("klientens sync-motor", () => {
  beforeEach(async () => {
    received = [];
    await clearLocalData();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skriver lokalt og lægger i outbox i samme transaktion", async () => {
    await mutate("group", { id: "gruppe-1", name: "Spilklubben" }, user);

    const row = await db.group.get("gruppe-1");
    expect(row?.name).toBe("Spilklubben");
    // Rækken er markeret som ikke-sendt, så UI'et kan sige "gemmes senere".
    expect(row?.pending).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it("tømmer outboxen når serveren har kvitteret", async () => {
    stubServer({});
    await mutate("group", { id: "gruppe-1", name: "Spilklubben" }, user);

    await sync();

    expect(received).toHaveLength(1);
    expect(received[0]!.table).toBe("group");
    expect(await db.outbox.count()).toBe(0);
    // Rækken bliver liggende — det er kun køen der tømmes.
    expect((await db.group.get("gruppe-1"))?.name).toBe("Spilklubben");
    expect(syncStatus().state).toBe("idle");
  });

  it("behandler stale som færdigt, så køen ikke går i stå", async () => {
    stubServer({
      push: (mutations) => ({
        results: mutations.map((mutation) => ({ opId: mutation.opId, status: "stale" })),
        serverSeq: 2,
      }),
    });
    await mutate("group", { id: "gruppe-1", name: "Min version" }, user);

    await sync();

    expect(await db.outbox.count()).toBe(0);
    expect(await db.rejects.count()).toBe(0);
  });

  it("flytter afviste ændringer ud af køen og gemmer begrundelsen", async () => {
    stubServer({
      push: (mutations) => ({
        results: mutations.map((mutation) => ({
          opId: mutation.opId,
          status: "rejected",
          message: "Du er ikke medlem af den gruppe.",
        })),
        serverSeq: 3,
      }),
    });
    await mutate("play", {
      id: "parti-1",
      groupId: "gruppe-fremmed",
      gameId: "spil-1",
      playedAt: Date.now(),
      location: null,
      durationMinutes: null,
      notes: null,
      coopResult: null,
    }, user);

    await sync();

    expect(await db.outbox.count()).toBe(0);
    const rejects = await db.rejects.toArray();
    expect(rejects).toHaveLength(1);
    expect(rejects[0]!.message).toMatch(/ikke medlem/i);
    expect(syncStatus().rejected).toBe(1);
  });

  it("lader ikke pull overskrive en ændring der stadig ligger i kø", async () => {
    // Serveren har en ældre version af samme række. Klienten har rettet lokalt
    // og har endnu ikke fået sin ændring afsted.
    stubServer({
      push: () => ({ results: [], serverSeq: 4 }),
      pull: () => ({
        cursor: 9,
        changes: {
          group: [
            {
              id: "gruppe-1",
              name: "Serverens navn",
              updatedAt: 1,
              deletedAt: null,
              updatedBy: "en-anden",
            },
          ],
        },
      }),
    });

    await mutate("group", { id: "gruppe-1", name: "Mit navn" }, user);
    await sync();

    expect((await db.group.get("gruppe-1"))?.name).toBe("Mit navn");
    // Køen står stadig, fordi serveren ikke kvitterede.
    expect(await db.outbox.count()).toBe(1);
  });

  it("anvender serverens rækker når intet ligger i kø, og rykker cursoren", async () => {
    stubServer({
      pull: () => ({
        cursor: 42,
        changes: {
          group: [
            {
              id: "gruppe-2",
              name: "Fra serveren",
              updatedAt: 5,
              deletedAt: null,
              updatedBy: "en-anden",
            },
          ],
        },
      }),
    });

    await sync();

    expect((await db.group.get("gruppe-2"))?.name).toBe("Fra serveren");
    expect(await getMeta(CURSOR_KEY, 0)).toBe(42);
  });

  it("sender sletninger som soft delete", async () => {
    stubServer({});
    await mutate("group", { id: "gruppe-1", name: "Spilklubben" }, user);
    await sync();

    await remove("group", "gruppe-1", user);

    const row = await db.group.get("gruppe-1");
    // Rækken bliver liggende med deletedAt sat — ellers kunne sletningen ikke synkes.
    expect(row).toBeDefined();
    expect(typeof row?.deletedAt).toBe("number");

    await sync();
    expect(received[0]!.op).toBe("delete");
  });

  it("går i offline-tilstand uden at tabe køen", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await mutate("group", { id: "gruppe-1", name: "Spilklubben" }, user);
    await sync();

    expect(syncStatus().state).toBe("offline");
    expect(await db.outbox.count()).toBe(1);
    expect(syncStatus().pending).toBe(1);
  });
});
