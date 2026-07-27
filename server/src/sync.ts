import {
  and,
  eq,
  gt,
  inArray,
  lte,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import {
  SYNC_PAYLOAD_SCHEMAS,
  SYNC_TABLES,
  type Mutation,
  type MutationResult,
  type SyncTable,
} from "@spil/shared";
import {
  assertGroupAccess,
  groupCreator,
  groupMemberCount,
  isGroupMember,
  playGroupId,
  userGroupIds,
} from "./access.js";
import { db } from "./db/client.js";
import {
  game,
  group,
  groupMember,
  photo,
  play,
  playParticipant,
  player,
  syncOp,
  syncSeq,
} from "./db/schema.js";
import { forbidden, HttpError } from "./http.js";

const NEVER: SQL = sql`1 = 0`;

type Meta = {
  updatedAt: number;
  serverSeq: number;
  deletedAt: number | null;
  updatedBy: string;
};

/** Sekvensen som pull'en står ved lige nu. Alt herunder er allerede skrevet. */
export function currentServerSeq(): number {
  return db.select({ value: syncSeq.value }).from(syncSeq).where(eq(syncSeq.id, 1)).get()
    ?.value ?? 0;
}

/**
 * Tildeler næste sekvensnummer. Kaldes inde i push-transaktionen, så to
 * samtidige pushes ikke kan få det samme nummer — SQLite serialiserer
 * skrivetransaktioner.
 *
 * Enhver serverside-skrivning til en synkroniseret tabel skal kalde den her.
 * Gør den ikke det, får rækken et for lavt nummer og bliver aldrig hentet.
 */
export function allocateServerSeq(): number {
  db.update(syncSeq)
    .set({ value: sql`${syncSeq.value} + 1` })
    .where(eq(syncSeq.id, 1))
    .run();
  return currentServerSeq();
}

// Payloaden er allerede valideret af tabellens zod-skema, så feltnavnene matcher
// kolonnerne 1:1. Typen løsnes her og kun her.
type Payload = Record<string, unknown>;

type WriteContext = {
  userId: string;
  id: string;
  op: "upsert" | "delete";
  payload: Payload;
  existing: (Payload & { updatedAt: number; updatedBy: string | null }) | undefined;
};

type TableConfig = {
  /** Kaster hvis brugeren ikke må skrive rækken. */
  checkWrite(ctx: WriteContext): void;
  read(id: string): (Payload & { updatedAt: number; updatedBy: string | null }) | undefined;
  upsert(id: string, payload: Payload, meta: Meta): void;
  softDelete(id: string, meta: Meta): void;
  changed(userId: string, groupIds: string[], since: number, cursor: number): Payload[];
};

// Vinduet (since, cursor]. Cursoren låses før læsningen, så rækker der skrives
// undervejs kommer med i næste pull i stedet for at blive sprunget over.
function window(column: AnyColumn, since: number, cursor: number) {
  return and(gt(column, since), lte(column, cursor));
}

// Undergruppe: id'erne på de partier brugeren har adgang til.
function visiblePlayIds(groupIds: string[]) {
  return db
    .select({ id: play.id })
    .from(play)
    .where(groupIds.length > 0 ? inArray(play.groupId, groupIds) : NEVER);
}

const configs: Record<SyncTable, TableConfig> = {
  player: {
    checkWrite({ userId, payload, existing }) {
      const claimed = payload.userId as string | null | undefined;
      if (claimed && claimed !== userId) {
        throw forbidden("Du kan ikke knytte en spiller til en anden konto.");
      }
      const owner = existing?.userId as string | null | undefined;
      if (owner && owner !== userId) {
        throw forbidden("Spilleren tilhører en anden konto.");
      }
    },
    read: (id) => db.select().from(player).where(eq(player.id, id)).get(),
    upsert(id, payload, meta) {
      const row = {
        id,
        userId: (payload.userId as string | null) ?? null,
        name: payload.name as string,
        ...meta,
      };
      db.insert(player).values(row).onConflictDoUpdate({ target: player.id, set: row }).run();
    },
    softDelete(id, meta) {
      db.update(player).set(meta).where(eq(player.id, id)).run();
    },
    changed(userId, groupIds, since, cursor) {
      // Egne og alle spillere man deler gruppe med — også gæsterne.
      const inMyGroups = db
        .select({ id: groupMember.playerId })
        .from(groupMember)
        .where(groupIds.length > 0 ? inArray(groupMember.groupId, groupIds) : NEVER);
      return db
        .select()
        .from(player)
        .where(
          and(
            window(player.serverSeq, since, cursor),
            or(eq(player.userId, userId), inArray(player.id, inMyGroups)),
          ),
        )
        .all();
    },
  },

  group: {
    checkWrite({ userId, id, existing }) {
      // Findes gruppen ikke endnu, er det en oprettelse — den er altid tilladt.
      // Opretteren bliver ejer i kraft af updated_by og tilføjer sig selv som medlem.
      if (existing) assertGroupAccess(userId, id);
    },
    read: (id) => db.select().from(group).where(eq(group.id, id)).get(),
    upsert(id, payload, meta) {
      const row = { id, name: payload.name as string, ...meta };
      db.insert(group).values(row).onConflictDoUpdate({ target: group.id, set: row }).run();
    },
    softDelete(id, meta) {
      db.update(group).set(meta).where(eq(group.id, id)).run();
    },
    changed(_userId, groupIds, since, cursor) {
      return db
        .select()
        .from(group)
        .where(
          and(
            window(group.serverSeq, since, cursor),
            groupIds.length > 0 ? inArray(group.id, groupIds) : NEVER,
          ),
        )
        .all();
    },
  },

  groupMember: {
    checkWrite({ userId, payload, existing }) {
      const groupId = (payload.groupId ?? existing?.groupId) as string | undefined;
      if (!groupId) throw forbidden("Medlemskabet mangler en gruppe.");
      if (isGroupMember(userId, groupId)) return;
      // Første medlem i en gruppe man selv lige har oprettet — typisk offline,
      // hvor gruppe og medlemskab kommer i samme push.
      if (groupMemberCount(groupId) === 0 && groupCreator(groupId) === userId) return;
      throw forbidden("Du er ikke medlem af den gruppe.");
    },
    read: (id) => db.select().from(groupMember).where(eq(groupMember.id, id)).get(),
    upsert(id, payload, meta) {
      const row = {
        id,
        groupId: payload.groupId as string,
        playerId: payload.playerId as string,
        role: payload.role as string,
        ...meta,
      };
      db.insert(groupMember)
        .values(row)
        .onConflictDoUpdate({ target: groupMember.id, set: row })
        .run();
    },
    softDelete(id, meta) {
      db.update(groupMember).set(meta).where(eq(groupMember.id, id)).run();
    },
    changed(_userId, groupIds, since, cursor) {
      return db
        .select()
        .from(groupMember)
        .where(
          and(
            window(groupMember.serverSeq, since, cursor),
            groupIds.length > 0 ? inArray(groupMember.groupId, groupIds) : NEVER,
          ),
        )
        .all();
    },
  },

  game: {
    // Spilbiblioteket er fælles for hele installationen — der er ingen grund til
    // at hver gruppe skal oprette "Catan" forfra.
    checkWrite() {},
    read: (id) => db.select().from(game).where(eq(game.id, id)).get(),
    upsert(id, payload, meta) {
      const row = {
        id,
        title: payload.title as string,
        bggId: (payload.bggId as number | null) ?? null,
        year: (payload.year as number | null) ?? null,
        minPlayers: (payload.minPlayers as number | null) ?? null,
        maxPlayers: (payload.maxPlayers as number | null) ?? null,
        thumbnailPath: (payload.thumbnailPath as string | null) ?? null,
        ...meta,
      };
      db.insert(game).values(row).onConflictDoUpdate({ target: game.id, set: row }).run();
    },
    softDelete(id, meta) {
      db.update(game).set(meta).where(eq(game.id, id)).run();
    },
    changed(_userId, _groupIds, since, cursor) {
      return db.select().from(game).where(window(game.serverSeq, since, cursor)).all();
    },
  },

  play: {
    checkWrite({ userId, payload, existing }) {
      const groupId = (payload.groupId ?? existing?.groupId) as string | undefined;
      if (!groupId) throw forbidden("Partiet mangler en gruppe.");
      assertGroupAccess(userId, groupId);
    },
    read: (id) => db.select().from(play).where(eq(play.id, id)).get(),
    upsert(id, payload, meta) {
      const row = {
        id,
        groupId: payload.groupId as string,
        gameId: payload.gameId as string,
        playedAt: payload.playedAt as number,
        location: (payload.location as string | null) ?? null,
        durationMinutes: (payload.durationMinutes as number | null) ?? null,
        notes: (payload.notes as string | null) ?? null,
        coopResult: (payload.coopResult as string | null) ?? null,
        ...meta,
      };
      db.insert(play).values(row).onConflictDoUpdate({ target: play.id, set: row }).run();
    },
    softDelete(id, meta) {
      db.update(play).set(meta).where(eq(play.id, id)).run();
    },
    changed(_userId, groupIds, since, cursor) {
      return db
        .select()
        .from(play)
        .where(
          and(
            window(play.serverSeq, since, cursor),
            groupIds.length > 0 ? inArray(play.groupId, groupIds) : NEVER,
          ),
        )
        .all();
    },
  },

  playParticipant: {
    checkWrite({ userId, payload, existing }) {
      const playId = (payload.playId ?? existing?.playId) as string | undefined;
      if (!playId) throw forbidden("Deltageren mangler et parti.");
      const groupId = playGroupId(playId);
      if (!groupId) throw forbidden("Partiet findes ikke.");
      assertGroupAccess(userId, groupId);
    },
    read: (id) =>
      db.select().from(playParticipant).where(eq(playParticipant.id, id)).get(),
    upsert(id, payload, meta) {
      const row = {
        id,
        playId: payload.playId as string,
        playerId: payload.playerId as string,
        placement: (payload.placement as number | null) ?? null,
        score: (payload.score as number | null) ?? null,
        ...meta,
      };
      db.insert(playParticipant)
        .values(row)
        .onConflictDoUpdate({ target: playParticipant.id, set: row })
        .run();
    },
    softDelete(id, meta) {
      db.update(playParticipant).set(meta).where(eq(playParticipant.id, id)).run();
    },
    changed(_userId, groupIds, since, cursor) {
      return db
        .select()
        .from(playParticipant)
        .where(
          and(
            window(playParticipant.serverSeq, since, cursor),
            inArray(playParticipant.playId, visiblePlayIds(groupIds)),
          ),
        )
        .all();
    },
  },

  photo: {
    checkWrite({ userId, payload, existing }) {
      const playId = (payload.playId ?? existing?.playId) as string | undefined;
      if (!playId) throw forbidden("Billedet mangler et parti.");
      const groupId = playGroupId(playId);
      if (!groupId) throw forbidden("Partiet findes ikke.");
      assertGroupAccess(userId, groupId);
    },
    read: (id) => db.select().from(photo).where(eq(photo.id, id)).get(),
    upsert(id, payload, meta) {
      const row = {
        id,
        playId: payload.playId as string,
        filePath: payload.filePath as string,
        width: (payload.width as number | null) ?? null,
        height: (payload.height as number | null) ?? null,
        takenAt: (payload.takenAt as number | null) ?? null,
        ...meta,
      };
      db.insert(photo).values(row).onConflictDoUpdate({ target: photo.id, set: row }).run();
    },
    softDelete(id, meta) {
      db.update(photo).set(meta).where(eq(photo.id, id)).run();
    },
    changed(_userId, groupIds, since, cursor) {
      return db
        .select()
        .from(photo)
        .where(
          and(
            window(photo.serverSeq, since, cursor),
            inArray(photo.playId, visiblePlayIds(groupIds)),
          ),
        )
        .all();
    },
  },
};

/**
 * Last-write-wins på rækkeniveau.
 *
 * Ved samme tidsstempel afgøres det på updated_by, så to klienter der skriver i
 * samme millisekund nnår frem til det samme resultat uanset hvilken rækkefølge
 * pushene ankommer i. Uden det tiebreak ville de kunne divergere permanent.
 */
function incomingWins(
  incomingAt: number,
  incomingBy: string,
  existingAt: number,
  existingBy: string | null,
): boolean {
  if (incomingAt !== existingAt) return incomingAt > existingAt;
  return incomingBy > (existingBy ?? "");
}

function applyMutation(
  userId: string,
  mutation: Mutation,
  now: number,
  serverSeq: number,
): MutationResult {
  const config = configs[mutation.table];

  const seen = db
    .select({ opId: syncOp.opId })
    .from(syncOp)
    .where(eq(syncOp.opId, mutation.opId))
    .get();
  if (seen) return { opId: mutation.opId, status: "duplicate" };

  // Klokkeskævhed på klienten må ikke kunne skrive rækker vilkårligt langt ud i
  // fremtiden og dermed låse dem mod senere rettelser.
  const updatedAt = Math.min(mutation.updatedAt, now);

  const existing = config.read(mutation.id);
  if (existing && !incomingWins(updatedAt, userId, existing.updatedAt, existing.updatedBy)) {
    return { opId: mutation.opId, status: "stale" };
  }

  let payload: Payload = {};
  if (mutation.op === "upsert") {
    const parsed = SYNC_PAYLOAD_SCHEMAS[mutation.table].safeParse(mutation.payload);
    if (!parsed.success) {
      return {
        opId: mutation.opId,
        status: "rejected",
        message: parsed.error.issues[0]?.message ?? "Ugyldige data.",
      };
    }
    payload = parsed.data as Payload;
    if (payload.id !== mutation.id) {
      return { opId: mutation.opId, status: "rejected", message: "Id'et matcher ikke." };
    }
  }

  try {
    config.checkWrite({ userId, id: mutation.id, op: mutation.op, payload, existing });
  } catch (error) {
    if (error instanceof HttpError) {
      return { opId: mutation.opId, status: "rejected", message: error.message };
    }
    throw error;
  }

  const meta: Meta = { updatedAt, serverSeq, deletedAt: null, updatedBy: userId };

  if (mutation.op === "delete") {
    if (!existing) {
      // Sletning af noget vi aldrig har set. Registrér opId'et og lad det ligge.
      db.insert(syncOp)
        .values({ opId: mutation.opId, userId, appliedAt: now })
        .run();
      return { opId: mutation.opId, status: "applied" };
    }
    // Soft delete. Hard delete ville betyde at andre klienter aldrig fik at vide
    // at rækken var væk.
    config.softDelete(mutation.id, { ...meta, deletedAt: updatedAt });
  } else {
    config.upsert(mutation.id, payload, meta);
  }

  db.insert(syncOp).values({ opId: mutation.opId, userId, appliedAt: now }).run();
  return { opId: mutation.opId, status: "applied" };
}

export function push(userId: string, mutations: Mutation[]): {
  results: MutationResult[];
  serverSeq: number;
} {
  const now = Date.now();

  // Anvend i tabellernes afhængighedsrækkefølge, så et parti aldrig sættes ind
  // før den gruppe og det spil det peger på. Rækkefølgen inden for en tabel
  // bevares.
  const ordered = [...mutations].sort(
    (a, b) => SYNC_TABLES.indexOf(a.table) - SYNC_TABLES.indexOf(b.table),
  );

  // Hele batchen i én transaktion: enten kommer den igennem, eller også ruller
  // den tilbage. Afviste enkeltmutationer er ikke fejl — de rapporteres tilbage.
  const { results, serverSeq } = db.transaction(() => {
    // Hele batchen deler ét sekvensnummer. Cursoren betyder "jeg har set alt til
    // og med N", så en batch skal enten være helt inde eller helt ude.
    const seq = allocateServerSeq();
    return {
      results: ordered.map((mutation) => applyMutation(userId, mutation, now, seq)),
      serverSeq: seq,
    };
  });

  const byOpId = new Map(results.map((result) => [result.opId, result]));
  return {
    // Svaret følger klientens oprindelige rækkefølge, ikke den sorterede.
    results: mutations.map(
      (mutation) =>
        byOpId.get(mutation.opId) ?? { opId: mutation.opId, status: "rejected" as const },
    ),
    // Til fejlsøgning. Klienten må *ikke* bruge det som pull-cursor — den har
    // ikke set de ændringer andre har lavet i mellemtiden.
    serverSeq,
  };
}

export function pull(userId: string, since: number): {
  cursor: number;
  changes: Record<string, Payload[]>;
} {
  // Cursoren låses før læsningen. Rækker der skrives undervejs får et højere
  // sekvensnummer og kommer med i næste pull i stedet for at blive sprunget over.
  const cursor = currentServerSeq();
  const groupIds = userGroupIds(userId);

  const changes: Record<string, Payload[]> = {};
  for (const table of SYNC_TABLES) {
    changes[table] = configs[table].changed(userId, groupIds, since, cursor);
  }

  return { cursor, changes };
}
