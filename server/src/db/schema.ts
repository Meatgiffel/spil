import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Better Auth-tabeller
//
// Feltnavnene (JS-siden) skal matche Better Auths modelfelter præcist — adapteren
// slår op på dem. Kolonnenavnene er vores egne og må gerne være snake_case.
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  // Fra admin-plugin'et. Adgangsgrænsen i appen er gruppen — rollen styrer kun
  // hvem der må udstede invitationsnøgler.
  role: text("role").notNull().default("user"),
  banned: integer("banned", { mode: "boolean" }).notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// Better Auths rate limiter med databaselagring, så login-forsøg tælles på
// tværs af genstarter i stedet for at nulstilles hver gang servicen restarter.
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key"),
  count: integer("count"),
  lastRequest: integer("last_request"),
});

// ---------------------------------------------------------------------------
// Invitationsnøgler
// ---------------------------------------------------------------------------

export const inviteKey = sqliteTable(
  "invite_key",
  {
    id: text("id").primaryKey(),
    // Kun sha256 gemmes. Selve nøglen vises én gang ved oprettelse og kan aldrig hentes igen.
    keyHash: text("key_hash").notNull().unique(),
    label: text("label"),
    maxUses: integer("max_uses").notNull().default(1),
    uses: integer("uses").notNull().default(0),
    expiresAt: integer("expires_at"),
    revokedAt: integer("revoked_at"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("invite_key_created_by_idx").on(table.createdBy)],
);

export const inviteKeyUse = sqliteTable(
  "invite_key_use",
  {
    id: text("id").primaryKey(),
    inviteKeyId: text("invite_key_id")
      .notNull()
      .references(() => inviteKey.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    usedAt: integer("used_at").notNull(),
  },
  (table) => [
    index("invite_key_use_key_idx").on(table.inviteKeyId),
    uniqueIndex("invite_key_use_user_idx").on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// Domænetabeller
//
// Alle har de samme fire sync-kolonner: updated_at (ms), server_seq (cursor),
// deleted_at (soft delete) og updated_by. Hard delete er forbudt — klienter
// ville aldrig få at vide at rækken er væk. Id'er er UUIDv7 genereret på klienten.
// ---------------------------------------------------------------------------

const syncColumns = {
  // Klientens tidsstempel. Bruges *kun* til last-write-wins.
  updatedAt: integer("updated_at").notNull(),
  // Serverens egen monotone sekvens. Bruges *kun* som sync-cursor.
  //
  // De to må ikke slås sammen: en ændring lavet offline i går har et updated_at
  // i fortiden, og en klient der allerede har synkroniseret forbi det tidspunkt
  // ville aldrig få den at se. Sekvensen tildeles når serveren modtager rækken,
  // så den altid er nyere end alt hvad klienterne har hentet.
  //
  // Bevidst uden default: en række med server_seq = 0 ville aldrig blive hentet
  // af nogen klient. Uden default bliver det en compile-fejl at glemme den.
  serverSeq: integer("server_seq").notNull(),
  deletedAt: integer("deleted_at"),
  updatedBy: text("updated_by"),
};

export const player = sqliteTable(
  "player",
  {
    id: text("id").primaryKey(),
    // Sat: spilleren er en rigtig konto. Null: gæst uden konto.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    ...syncColumns,
  },
  (table) => [
    uniqueIndex("player_user_id_idx").on(table.userId),
    index("player_server_seq_idx").on(table.serverSeq),
  ],
);

export const group = sqliteTable(
  "group",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ...syncColumns,
  },
  (table) => [index("group_server_seq_idx").on(table.serverSeq)],
);

export const groupMember = sqliteTable(
  "group_member",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references(() => player.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    ...syncColumns,
  },
  (table) => [
    uniqueIndex("group_member_unique_idx").on(table.groupId, table.playerId),
    index("group_member_player_idx").on(table.playerId),
    index("group_member_server_seq_idx").on(table.serverSeq),
  ],
);

export const game = sqliteTable(
  "game",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    bggId: integer("bgg_id"),
    year: integer("year"),
    minPlayers: integer("min_players"),
    maxPlayers: integer("max_players"),
    thumbnailPath: text("thumbnail_path"),
    ...syncColumns,
  },
  (table) => [index("game_server_seq_idx").on(table.serverSeq)],
);

export const play = sqliteTable(
  "play",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    gameId: text("game_id")
      .notNull()
      .references(() => game.id, { onDelete: "restrict" }),
    playedAt: integer("played_at").notNull(),
    location: text("location"),
    durationMinutes: integer("duration_minutes"),
    notes: text("notes"),
    // Sat for co-op-spil hvor holdet samlet vinder eller taber.
    coopResult: text("coop_result"),
    ...syncColumns,
  },
  (table) => [
    index("play_group_idx").on(table.groupId),
    index("play_played_at_idx").on(table.playedAt),
    index("play_server_seq_idx").on(table.serverSeq),
  ],
);

export const playParticipant = sqliteTable(
  "play_participant",
  {
    id: text("id").primaryKey(),
    playId: text("play_id")
      .notNull()
      .references(() => play.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references(() => player.id, { onDelete: "cascade" }),
    // 1 = vinder. Samme tal på flere deltagere betyder uafgjort. Null ved co-op.
    placement: integer("placement"),
    // Point registreres ikke i UI'et. Kolonnen findes så det kan tilføjes senere
    // uden en migration — se BESLUTNINGER.md.
    score: integer("score"),
    ...syncColumns,
  },
  (table) => [
    uniqueIndex("play_participant_unique_idx").on(table.playId, table.playerId),
    index("play_participant_player_idx").on(table.playerId),
    index("play_participant_server_seq_idx").on(table.serverSeq),
  ],
);

export const photo = sqliteTable(
  "photo",
  {
    id: text("id").primaryKey(),
    playId: text("play_id")
      .notNull()
      .references(() => play.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    width: integer("width"),
    height: integer("height"),
    takenAt: integer("taken_at"),
    ...syncColumns,
  },
  (table) => [
    index("photo_play_idx").on(table.playId),
    index("photo_server_seq_idx").on(table.serverSeq),
  ],
);

// ---------------------------------------------------------------------------
// Sync-infrastruktur
// ---------------------------------------------------------------------------

// Den monotone sekvens der bruges som sync-cursor. Præcis én række (id = 1).
// SQLite serialiserer skrivetransaktioner, så to samtidige pushes ikke kan få
// samme nummer.
export const syncSeq = sqliteTable("sync_seq", {
  id: integer("id").primaryKey(),
  value: integer("value").notNull().default(0),
});

// Sete opId'er, så en push der timeouter og gentages er idempotent.
export const syncOp = sqliteTable(
  "sync_op",
  {
    opId: text("op_id").primaryKey(),
    userId: text("user_id").notNull(),
    appliedAt: integer("applied_at").notNull(),
  },
  (table) => [index("sync_op_applied_at_idx").on(table.appliedAt)],
);

// Cache af BoardGameGeek-svar, så API'et ikke rammes på hvert tastetryk.
export const bggCache = sqliteTable("bgg_cache", {
  queryHash: text("query_hash").primaryKey(),
  payload: text("payload").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

export const schema = {
  user,
  session,
  account,
  verification,
  rateLimit,
  inviteKey,
  inviteKeyUse,
  player,
  group,
  groupMember,
  game,
  play,
  playParticipant,
  photo,
  syncSeq,
  syncOp,
  bggCache,
};

export { sql };
