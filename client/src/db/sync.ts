import {
  PUSH_BATCH_LIMIT,
  SYNC_TABLES,
  type Mutation,
  type MutationResult,
  type SyncTable,
} from "@spil/shared";
import { ApiError, NotLoggedInError, post } from "../api.js";
import {
  CURSOR_KEY,
  SESSION_KEY,
  db,
  getMeta,
  mutate,
  setMeta,
  tableOf,
  type CurrentUser,
  type OutboxEntry,
} from "./local.js";

export type SyncState =
  | "idle"
  | "syncing"
  | "offline"
  | "needsReauth"
  | "error";

export type SyncStatus = {
  state: SyncState;
  lastSyncedAt: number | null;
  pending: number;
  rejected: number;
};

let status: SyncStatus = {
  state: "idle",
  lastSyncedAt: null,
  pending: 0,
  rejected: 0,
};

const listeners = new Set<(status: SyncStatus) => void>();

export function subscribeSync(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

export function syncStatus(): SyncStatus {
  return status;
}

async function setStatus(patch: Partial<SyncStatus>): Promise<void> {
  status = {
    ...status,
    ...patch,
    pending: patch.pending ?? (await db.outbox.count()),
    rejected: patch.rejected ?? (await db.rejects.count()),
  };
  for (const listener of listeners) listener(status);
}

// ── Push ───────────────────────────────────────────────────────────────────

type PushResponse = { results: MutationResult[]; serverSeq: number };

async function pushOnce(): Promise<boolean> {
  const batch = await db.outbox.orderBy("createdAt").limit(PUSH_BATCH_LIMIT).toArray();
  if (batch.length === 0) return false;

  const mutations: Mutation[] = batch.map((entry) => ({
    opId: entry.opId,
    table: entry.table,
    id: entry.id,
    op: entry.op,
    updatedAt: entry.updatedAt,
    payload: entry.payload,
  }));

  const response = await post<PushResponse>("/api/sync/push", { mutations });
  const byOpId = new Map(response.results.map((result) => [result.opId, result]));

  const rejected: OutboxEntry[] = [];
  const done: string[] = [];

  for (const entry of batch) {
    const result = byOpId.get(entry.opId);
    if (!result) continue;
    if (result.status === "rejected") {
      rejected.push({ ...entry, lastError: result.message });
    } else {
      // applied, duplicate og stale er alle "færdig". Ved stale henter næste
      // pull serverens version, som så vinder.
      done.push(entry.opId);
    }
  }

  const settled = [...done, ...rejected.map((entry) => entry.opId)];
  const touched = batch
    .filter((entry) => settled.includes(entry.opId))
    .map((entry) => ({ table: entry.table, id: entry.id }));

  await db.transaction(
    "rw",
    [db.outbox, db.rejects, ...SYNC_TABLES.map(tableOf)],
    async () => {
      await db.outbox.bulkDelete(settled);

      if (rejected.length > 0) {
        await db.rejects.bulkPut(
          rejected.map((entry) => ({
            opId: entry.opId,
            table: entry.table,
            id: entry.id,
            message: entry.lastError ?? "unknown",
            at: Date.now(),
          })),
        );
      }

      // "Gemmes senere" fjernes her, ikke først når rækken tilfældigvis kommer
      // retur i næste pull. Et duplicate- eller stale-svar sender ingen række
      // tilbage, og markeringen ville så blive stående for evigt.
      for (const { table, id } of touched) {
        const stillQueued = await db.outbox
          .where("table")
          .equals(table)
          .filter((entry) => entry.id === id)
          .count();
        if (stillQueued === 0) {
          await tableOf(table).update(id, { pending: undefined });
        }
      }
    },
  );

  // Der kan være flere end ét batch i køen.
  return (await db.outbox.count()) > 0;
}

async function pushAll(): Promise<void> {
  // Loopet er begrænset, så en server der bliver ved med at afvise ikke kan
  // få klienten til at snurre i ring.
  for (let round = 0; round < 20; round += 1) {
    if (!(await pushOnce())) return;
  }
}

// ── Fotos ──────────────────────────────────────────────────────────────────

/**
 * Sender billeder taget offline afsted, ét ad gangen.
 *
 * Først når filen er kommet frem, oprettes photo-rækken — den skal have en
 * rigtig serversti. Fejler uploaden, bliver blobben liggende og prøves igen.
 */
async function uploadPendingPhotos(user: CurrentUser): Promise<void> {
  const pending = await db.blobs.orderBy("createdAt").toArray();

  for (const entry of pending) {
    const form = new FormData();
    form.append("playId", entry.playId);
    form.append("file", entry.blob, `${entry.id}.jpg`);

    // Ingen content-type her: browseren skal selv sætte multipart-grænsen.
    const response = await fetch("/api/uploads", {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });

    if (response.status === 401) throw new NotLoggedInError();
    if (!response.ok) {
      // 4xx er varigt: filen bliver aldrig accepteret, så den skal ikke blokere køen.
      if (response.status >= 400 && response.status < 500) {
        await db.transaction("rw", db.blobs, db.rejects, async () => {
          await db.blobs.delete(entry.id);
          await db.rejects.put({
            opId: entry.id,
            table: "photo",
            id: entry.id,
            message: "photo_rejected",
            at: Date.now(),
          });
        });
        continue;
      }
      return; // 5xx: prøv igen senere
    }

    const { filePath } = (await response.json()) as { filePath: string };
    await mutate(
      "photo",
      {
        id: entry.id,
        playId: entry.playId,
        filePath,
        width: null,
        height: null,
        takenAt: entry.createdAt,
      },
      user,
    );
    await db.blobs.delete(entry.id);
  }
}

// ── Pull ───────────────────────────────────────────────────────────────────

type PullResponse = {
  cursor: number;
  changes: Record<SyncTable, (Record<string, unknown> & { id: string })[]>;
};

async function pull(): Promise<void> {
  const since = await getMeta<number>(CURSOR_KEY, 0);
  const response = await post<PullResponse>("/api/sync/pull", { since });

  const stores = SYNC_TABLES.map(tableOf);
  await db.transaction("rw", [...stores, db.outbox, db.meta], async () => {
    for (const table of SYNC_TABLES) {
      const rows = response.changes[table] ?? [];
      if (rows.length === 0) continue;

      // Rækker der stadig ligger i outboxen springes over: vores egen ændring er
      // endnu ikke sendt, og serverens version ville skjule den for brugeren.
      const queued = new Set(
        (await db.outbox.where("table").equals(table).toArray()).map((entry) => entry.id),
      );

      const incoming = rows
        .filter((row) => !queued.has(row.id))
        .map((row) => ({ ...row, pending: undefined }));

      if (incoming.length > 0) {
        await tableOf(table).bulkPut(
          incoming as unknown as Parameters<ReturnType<typeof tableOf>["bulkPut"]>[0],
        );
      }
    }
    await db.meta.put({ key: CURSOR_KEY, value: response.cursor });
  });
}

// ── Loop ───────────────────────────────────────────────────────────────────

let running: Promise<void> | null = null;

export function sync(): Promise<void> {
  // Kun én kørsel ad gangen. Kaldes fra flere steder: app-start, online-event,
  // visibilitychange, timer og efter hver lokal ændring.
  if (running) return running;

  running = (async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await setStatus({ state: "offline" });
      return;
    }
    await setStatus({ state: "syncing" });
    try {
      const user = await getMeta<CurrentUser | null>(SESSION_KEY, null);
      if (user) await uploadPendingPhotos(user);
      await pushAll();
      await pull();
      await setStatus({ state: "idle", lastSyncedAt: Date.now() });
    } catch (error) {
      if (error instanceof NotLoggedInError) {
        // Lokal data bliver liggende og kan stadig redigeres — kun serveren er utilgængelig.
        await setStatus({ state: "needsReauth" });
      } else if (error instanceof ApiError && error.code === "no_connection") {
        await setStatus({ state: "offline" });
      } else {
        // Uventede fejl skal kunne ses. Uden det her forsvinder fx en
        // Dexie-skemafejl i stilhed, og synkroniseringen ser bare "død" ud.
        console.error("Synkronisering fejlede:", error);
        await setStatus({ state: "error" });
      }
    } finally {
      running = null;
    }
  })();

  return running;
}

const IDLE_INTERVAL_MS = 60_000;
const RETRY_INTERVAL_MS = 5_000;

/**
 * Kører sync i baggrunden.
 *
 * Intervallet er ikke fast: er der noget i kø, eller fejlede sidste forsøg,
 * prøves der igen efter få sekunder i stedet for at vente et helt minut.
 *
 * Det er bevidst ikke kun online-eventet der driver det. Eventet er upålideligt
 * — det fyres ikke af bag captive portals, ikke altid ved skift mellem mobilnet
 * og wifi, og slet ikke under Playwrights offline-emulering. Hvis det var
 * eneste trigger, kunne en kø blive stående uden at nogen forsøgte igen.
 */
export function startSyncLoop(): () => void {
  let stopped = false;
  let handle: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (stopped) return;
    const { pending, state } = syncStatus();
    const soon = pending > 0 || state === "offline" || state === "error";
    handle = setTimeout(run, soon ? RETRY_INTERVAL_MS : IDLE_INTERVAL_MS);
  };

  const run = async () => {
    if (stopped) return;
    await sync();
    schedule();
  };

  // Hurtige veje ind: de sparer ventetid når de virker, men er ikke alene om det.
  const trigger = () => {
    if (handle) clearTimeout(handle);
    void run();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") trigger();
  };

  window.addEventListener("online", trigger);
  window.addEventListener("focus", trigger);
  window.addEventListener("offline", () => void setStatus({ state: "offline" }));
  document.addEventListener("visibilitychange", onVisible);

  void run();

  return () => {
    stopped = true;
    if (handle) clearTimeout(handle);
    window.removeEventListener("online", trigger);
    window.removeEventListener("focus", trigger);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export async function dismissRejections(): Promise<void> {
  await db.rejects.clear();
  await setStatus({});
}

export async function resetCursor(): Promise<void> {
  await setMeta(CURSOR_KEY, 0);
}
