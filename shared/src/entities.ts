import { z } from "zod";

// Alle id'er er UUIDv7 genereret på klienten, så offline-oprettelser aldrig kolliderer.
// Serveren accepterer klientens id og må ikke omskrive det.
export const idSchema = z.uuid({ error: "Ugyldigt id." });

// Better Auth genererer sine egne bruger-id'er, som ikke er UUID'er.
export const userIdSchema = z.string().min(1).max(64);

const trimmedText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, { error: `${label} må ikke være tom.` })
    .max(max, { error: `${label} må højst være ${max} tegn.` });

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().default(null);

const optionalInt = (min: number, max: number) =>
  z.number().int().min(min).max(max).nullable().default(null);

export const groupSchema = z.object({
  id: idSchema,
  name: trimmedText(80, "Gruppenavnet"),
});

export const playerSchema = z.object({
  id: idSchema,
  // Er userId sat, er spilleren en rigtig konto. Er den null, er det en gæst uden konto.
  userId: userIdSchema.nullable().default(null),
  name: trimmedText(80, "Spillernavnet"),
});

export const groupMemberSchema = z.object({
  id: idSchema,
  groupId: idSchema,
  playerId: idSchema,
  role: z.enum(["owner", "member"]).default("member"),
});

/**
 * Hvordan et parti afgøres.
 *
 * Typen huskes pr. spil, så man vælger den én gang og aldrig igen. "Afbrudt"
 * er bevidst *ikke* med her — et parti kan afbrydes uanset type, så det er et
 * selvstændigt flag.
 */
export const OUTCOME_TYPES = ["ranking", "score", "coop", "teams", "solo"] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];
export const outcomeTypeSchema = z.enum(OUTCOME_TYPES);

export const gameSchema = z.object({
  id: idSchema,
  title: trimmedText(200, "Spiltitlen"),
  // Huskes fra sidste parti, så registreringen ikke skal spørge hver gang.
  defaultOutcomeType: outcomeTypeSchema.nullable().default(null),
  // 6 nimmt!, golf og andre hvor færrest point vinder.
  lowScoreWins: z.boolean().default(false),
  bggId: optionalInt(1, 100_000_000),
  year: optionalInt(-4000, 2200),
  minPlayers: optionalInt(1, 99),
  maxPlayers: optionalInt(1, 99),
  thumbnailPath: optionalText(300),
});

export const playSchema = z.object({
  id: idSchema,
  groupId: idSchema,
  gameId: idSchema,
  playedAt: z.number().int().min(0),
  location: optionalText(120),
  durationMinutes: optionalInt(0, 60 * 24 * 7),
  notes: optionalText(4000),
  outcomeType: outcomeTypeSchema.default("ranking"),
  // Sat for samarbejds- og solospil, hvor der ikke er placeringer. Ellers null.
  coopResult: z.enum(["won", "lost"]).nullable().default(null),
  // Ved holdspil: navnet på det hold der vandt. Dækker også forrædere og
  // én-mod-alle, hvor "holdet" bare er den side man var på.
  winningTeam: optionalText(40),
  // Hvor langt nåede I — "Boss 4", "Mission 23". Fri tekst, fordi hvert spil
  // har sit eget begreb for det.
  milestone: optionalText(60),
  // Hvor tæt det var. Sekunder, så både "7 sek." og "4 min." kan rummes.
  timeRemainingSeconds: optionalInt(0, 60 * 60 * 24),
  difficulty: optionalText(40),
  // Partiet blev ikke spillet færdigt. Så er der ingen vinder, uanset type.
  abandoned: z.boolean().default(false),
});

export const playParticipantSchema = z.object({
  id: idSchema,
  playId: idSchema,
  playerId: idSchema,
  // 1 = vinder. Samme tal på flere deltagere betyder uafgjort. Null ved
  // samarbejde, hold og solo.
  placement: optionalInt(1, 99),
  // Holdnavn eller side. Ved holdspil afgør det sammen med play.winningTeam
  // hvem der vandt.
  team: optionalText(40),
  score: optionalInt(-1_000_000, 1_000_000),
});

export const photoSchema = z.object({
  id: idSchema,
  playId: idSchema,
  filePath: trimmedText(300, "Filstien"),
  width: optionalInt(1, 20000),
  height: optionalInt(1, 20000),
  takenAt: z.number().int().min(0).nullable().default(null),
});

export type Group = z.infer<typeof groupSchema>;
export type Player = z.infer<typeof playerSchema>;
export type GroupMember = z.infer<typeof groupMemberSchema>;
export type Game = z.infer<typeof gameSchema>;
export type Play = z.infer<typeof playSchema>;
export type PlayParticipant = z.infer<typeof playParticipantSchema>;
export type Photo = z.infer<typeof photoSchema>;
