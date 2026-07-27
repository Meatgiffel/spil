import { z } from "zod";
import {
  gameSchema,
  groupMemberSchema,
  groupSchema,
  idSchema,
  photoSchema,
  playParticipantSchema,
  playSchema,
  playerSchema,
} from "./entities.js";

// Rækkefølgen er en afhængighedsrækkefølge: en tabel må kun referere tabeller før den.
// Både push og pull anvender ændringer i denne rækkefølge, så fremmednøgler altid holder.
export const SYNC_TABLES = [
  "player",
  "group",
  "groupMember",
  "game",
  "play",
  "playParticipant",
  "photo",
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

export const syncTableSchema = z.enum(SYNC_TABLES);

export const SYNC_PAYLOAD_SCHEMAS = {
  player: playerSchema,
  group: groupSchema,
  groupMember: groupMemberSchema,
  game: gameSchema,
  play: playSchema,
  playParticipant: playParticipantSchema,
  photo: photoSchema,
} as const satisfies Record<SyncTable, z.ZodType>;

// Felter som serveren selv styrer. De sendes med i pull, men accepteres aldrig fra klienten.
export const syncMetaSchema = z.object({
  updatedAt: z.number().int().min(0),
  deletedAt: z.number().int().min(0).nullable(),
  updatedBy: z.string().min(1).nullable(),
});

export type SyncMeta = z.infer<typeof syncMetaSchema>;

export const mutationSchema = z.object({
  // Idempotensnøgle. En push der timeouter kan gentages uden at anvende ændringen to gange.
  opId: idSchema,
  table: syncTableSchema,
  id: idSchema,
  op: z.enum(["upsert", "delete"]),
  // Klientens tidsstempel. Bruges til last-write-wins, med id som tiebreak.
  updatedAt: z.number().int().min(0),
  payload: z.unknown(),
});

export type Mutation = z.infer<typeof mutationSchema>;

export const PUSH_BATCH_LIMIT = 500;

export const pushRequestSchema = z.object({
  mutations: z.array(mutationSchema).max(PUSH_BATCH_LIMIT),
});

export const mutationResultSchema = z.object({
  opId: idSchema,
  status: z.enum([
    "applied", // anvendt
    "duplicate", // allerede set, opId kendt i forvejen
    "stale", // serveren har en nyere version, klienten henter den ved næste pull
    "rejected", // validering eller adgang afvist
  ]),
  message: z.string().optional(),
});

export type MutationResult = z.infer<typeof mutationResultSchema>;

export const pushResponseSchema = z.object({
  results: z.array(mutationResultSchema),
  // Sekvensnummeret batchen fik. Kun til fejlsøgning — klienten må ikke bruge
  // det som pull-cursor, for den har ikke set hvad andre har skrevet imens.
  serverSeq: z.number().int().min(0),
});

export const pullRequestSchema = z.object({
  since: z.number().int().min(0).default(0),
});

export const pullResponseSchema = z.object({
  cursor: z.number().int().min(0),
  // Soft-slettede rækker kommer med, så klienten kan fjerne dem lokalt.
  changes: z.record(syncTableSchema, z.array(z.record(z.string(), z.unknown()))),
});

export type PullResponse = z.infer<typeof pullResponseSchema>;
export type PushResponse = z.infer<typeof pushResponseSchema>;
