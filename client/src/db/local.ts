import Dexie, { type EntityTable } from "dexie";
import { v7 as uuidv7 } from "uuid";
import type {
  Game,
  Group,
  GroupMember,
  Photo,
  Play,
  PlayParticipant,
  Player,
  SyncTable,
} from "@spil/shared";

/**
 * IndexedDB er sandheden på klienten. Alt UI læser herfra og venter aldrig på
 * netværket. Skrivninger går ned i den lokale tabel *og* i outboxen i én og
 * samme transaktion, så en ændring aldrig kan blive synlig uden også at være
 * sat i kø til serveren.
 */

export type SyncMetaFields = {
  updatedAt: number;
  deletedAt: number | null;
  updatedBy: string | null;
  /** Sat lokalt indtil serveren har kvitteret. Driver "gemmes når du er online igen". */
  pending?: 1;
};

export type LocalPlayer = Player & SyncMetaFields;
export type LocalGroup = Group & SyncMetaFields;
export type LocalGroupMember = GroupMember & SyncMetaFields;
export type LocalGame = Game & SyncMetaFields;
export type LocalPlay = Play & SyncMetaFields;
export type LocalPlayParticipant = PlayParticipant & SyncMetaFields;
export type LocalPhoto = Photo & SyncMetaFields;

export type OutboxEntry = {
  opId: string;
  table: SyncTable;
  id: string;
  op: "upsert" | "delete";
  updatedAt: number;
  payload: unknown;
  createdAt: number;
  /** Antal mislykkede forsøg. Bruges til at holde op med at prøve på noget der er afvist. */
  attempts: number;
  lastError?: string;
};

/**
 * Fotos taget offline ligger her indtil de er uploadet.
 *
 * De går bevidst *ikke* gennem outboxen: en photo-række skal have en rigtig
 * serversti i file_path, og den findes først efter uploaden. Rækken oprettes
 * derfor først når filen er kommet frem — indtil da vises billedet fra den
 * lokale blob, så brugeren ikke kan se forskel.
 */
export type PendingBlob = {
  id: string;
  playId: string;
  blob: Blob;
  createdAt: number;
};

export async function queuePhoto(playId: string, blob: Blob): Promise<string> {
  const id = uuidv7();
  await db.blobs.add({ id, playId, blob, createdAt: Date.now() });
  return id;
}

/**
 * En mutation serveren har afvist — typisk fordi man er blevet fjernet fra en
 * gruppe siden ændringen blev lavet offline. Den tages ud af outboxen, så køen
 * ikke går i stå, og lægges her så UI'et kan sige det højt i stedet for at tabe
 * ændringen i stilhed.
 */
export type RejectedMutation = {
  opId: string;
  table: SyncTable;
  id: string;
  message: string;
  at: number;
};

export type MetaRow = { key: string; value: unknown };

export const db = new Dexie("spil") as Dexie & {
  player: EntityTable<LocalPlayer, "id">;
  group: EntityTable<LocalGroup, "id">;
  groupMember: EntityTable<LocalGroupMember, "id">;
  game: EntityTable<LocalGame, "id">;
  play: EntityTable<LocalPlay, "id">;
  playParticipant: EntityTable<LocalPlayParticipant, "id">;
  photo: EntityTable<LocalPhoto, "id">;
  outbox: EntityTable<OutboxEntry, "opId">;
  blobs: EntityTable<PendingBlob, "id">;
  rejects: EntityTable<RejectedMutation, "opId">;
  meta: EntityTable<MetaRow, "key">;
};

db.version(1).stores({
  player: "id, userId, deletedAt",
  group: "id, deletedAt",
  groupMember: "id, groupId, playerId, deletedAt",
  game: "id, title, bggId, deletedAt",
  play: "id, groupId, gameId, playedAt, deletedAt",
  playParticipant: "id, playId, playerId, deletedAt",
  photo: "id, playId, deletedAt",
  outbox: "opId, createdAt, table",
  blobs: "id, playId, createdAt",
  rejects: "opId, at",
  meta: "key",
});

export const SYNC_STORES: SyncTable[] = [
  "player",
  "group",
  "groupMember",
  "game",
  "play",
  "playParticipant",
  "photo",
];

// ── Metadata ───────────────────────────────────────────────────────────────

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export const CURSOR_KEY = "syncCursor";
export const SESSION_KEY = "session";

// ── Skrivninger ────────────────────────────────────────────────────────────

export type CurrentUser = { id: string; email: string; name: string; role: string };

export function tableOf(name: SyncTable) {
  return db[name] as unknown as EntityTable<
    { id: string } & SyncMetaFields & Record<string, unknown>,
    "id"
  >;
}

/**
 * Skriver en række lokalt og lægger den i outboxen i samme transaktion.
 *
 * Id'et skal være genereret på klienten (UUIDv7), så to enheder der opretter
 * hver sin række offline aldrig kolliderer.
 */
export async function mutate(
  table: SyncTable,
  payload: { id: string } & Record<string, unknown>,
  user: CurrentUser,
): Promise<void> {
  const updatedAt = Date.now();
  const entry: OutboxEntry = {
    opId: uuidv7(),
    table,
    id: payload.id,
    op: "upsert",
    updatedAt,
    payload,
    createdAt: updatedAt,
    attempts: 0,
  };
  await db.transaction("rw", tableOf(table), db.outbox, async () => {
    await tableOf(table).put({
      ...payload,
      updatedAt,
      deletedAt: null,
      updatedBy: user.id,
      pending: 1,
    });
    await db.outbox.add(entry);
  });
}

/** Soft delete. Rækken bliver liggende med deletedAt sat, så sletningen kan synkes. */
export async function remove(
  table: SyncTable,
  id: string,
  user: CurrentUser,
): Promise<void> {
  const updatedAt = Date.now();
  const entry: OutboxEntry = {
    opId: uuidv7(),
    table,
    id,
    op: "delete",
    updatedAt,
    payload: null,
    createdAt: updatedAt,
    attempts: 0,
  };
  await db.transaction("rw", tableOf(table), db.outbox, async () => {
    await tableOf(table).update(id, {
      updatedAt,
      deletedAt: updatedAt,
      updatedBy: user.id,
      pending: 1,
    });
    await db.outbox.add(entry);
  });
}

/** Rydder alt lokalt. Bruges ved log ud, så næste bruger ikke ser forrige brugers data. */
export async function clearLocalData(): Promise<void> {
  await db.transaction(
    "rw",
    [...SYNC_STORES.map(tableOf), db.outbox, db.blobs, db.rejects, db.meta],
    async () => {
      for (const store of SYNC_STORES) await tableOf(store).clear();
      await db.outbox.clear();
      await db.blobs.clear();
      await db.rejects.clear();
      await db.meta.clear();
    },
  );
}
