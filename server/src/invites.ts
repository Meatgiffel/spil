import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  INVITE_KEY_ALPHABET,
  INVITE_KEY_GROUPS,
  INVITE_KEY_GROUP_LENGTH,
  type CreateInviteKeyInput,
} from "@spil/shared";
import { db } from "./db/client.js";
import { inviteKey, inviteKeyUse, user } from "./db/schema.js";
import { badRequest, notFound } from "./http.js";

export function hashInviteKey(key: string): string {
  return createHash("sha256").update(key.trim().toLowerCase()).digest("hex");
}

function randomGroup(): string {
  let out = "";
  for (let i = 0; i < INVITE_KEY_GROUP_LENGTH; i += 1) {
    out += INVITE_KEY_ALPHABET[randomInt(INVITE_KEY_ALPHABET.length)];
  }
  return out;
}

// Alfabetet er forvekslingsfrit — ingen 0/O eller 1/l — så nøglen kan læses op i telefonen.
export function generateInviteKey(): string {
  return Array.from({ length: INVITE_KEY_GROUPS }, randomGroup).join("-");
}

export function countUsers(): number {
  const row = db.select({ count: sql<number>`count(*)` }).from(user).get();
  return row?.count ?? 0;
}

// Der findes ingen brugere endnu: første konto oprettes uden nøgle og bliver admin.
export function needsSetup(): boolean {
  return countUsers() === 0;
}

export type CreatedInviteKey = {
  id: string;
  key: string;
  label: string | null;
  maxUses: number;
  expiresAt: number | null;
};

export function createInviteKey(
  input: CreateInviteKeyInput,
  createdBy: string,
): CreatedInviteKey {
  const key = generateInviteKey();
  const id = uuidv7();
  db.insert(inviteKey)
    .values({
      id,
      keyHash: hashInviteKey(key),
      label: input.label,
      maxUses: input.maxUses,
      uses: 0,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdBy,
      createdAt: Date.now(),
    })
    .run();

  // Nøglen returneres her og kun her. Databasen har kun sha256'en.
  return { id, key, label: input.label, maxUses: input.maxUses, expiresAt: input.expiresAt };
}

export function listInviteKeys() {
  return db
    .select({
      id: inviteKey.id,
      label: inviteKey.label,
      maxUses: inviteKey.maxUses,
      uses: inviteKey.uses,
      expiresAt: inviteKey.expiresAt,
      revokedAt: inviteKey.revokedAt,
      createdAt: inviteKey.createdAt,
      createdBy: inviteKey.createdBy,
    })
    .from(inviteKey)
    .orderBy(desc(inviteKey.createdAt))
    .all();
}

export function revokeInviteKey(id: string): void {
  const result = db
    .update(inviteKey)
    .set({ revokedAt: Date.now() })
    .where(and(eq(inviteKey.id, id), isNull(inviteKey.revokedAt)))
    .run();
  if (result.changes === 0) {
    throw notFound("Invitationsnøglen findes ikke eller er allerede tilbagekaldt.");
  }
}

const INVALID_KEY_MESSAGE = "Invitationsnøglen er ikke gyldig.";

/**
 * Forbruger nøglen atomisk. Betingelserne står i WHERE-delen, så to samtidige
 * oprettelser med samme engangsnøgle ikke begge kan slippe igennem — kun den ene
 * får changes === 1.
 *
 * Nøglen forbruges *før* brugeren oprettes. Det betyder at en oprettelse der
 * fejler bagefter brænder nøglen; til gengæld kan en nøgle aldrig overforbruges,
 * og det er den egenskab der betyder noget. Kaldere tjekker derfor kendte
 * fejlkilder (fx optaget e-mail) inden de kalder her.
 */
export function consumeInviteKey(key: string): string {
  const now = Date.now();
  const hash = hashInviteKey(key);

  const result = db
    .update(inviteKey)
    .set({ uses: sql`${inviteKey.uses} + 1` })
    .where(
      and(
        eq(inviteKey.keyHash, hash),
        isNull(inviteKey.revokedAt),
        sql`${inviteKey.uses} < ${inviteKey.maxUses}`,
        sql`(${inviteKey.expiresAt} IS NULL OR ${inviteKey.expiresAt} > ${now})`,
      ),
    )
    .run();

  if (result.changes === 0) {
    throw badRequest(INVALID_KEY_MESSAGE, { inviteKey: INVALID_KEY_MESSAGE });
  }

  const row = db
    .select({ id: inviteKey.id })
    .from(inviteKey)
    .where(eq(inviteKey.keyHash, hash))
    .get();

  if (!row) {
    throw badRequest(INVALID_KEY_MESSAGE, { inviteKey: INVALID_KEY_MESSAGE });
  }
  return row.id;
}

export function recordInviteKeyUse(inviteKeyId: string, userId: string): void {
  db.insert(inviteKeyUse)
    .values({ id: uuidv7(), inviteKeyId, userId, usedAt: Date.now() })
    .run();
}

// Rulles tilbage hvis oprettelsen fejler efter at nøglen er forbrugt.
export function refundInviteKey(inviteKeyId: string): void {
  db.update(inviteKey)
    .set({ uses: sql`max(${inviteKey.uses} - 1, 0)` })
    .where(eq(inviteKey.id, inviteKeyId))
    .run();
}
