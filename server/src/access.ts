import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db/client.js";
import { group, groupMember, play, player } from "./db/schema.js";
import { forbidden } from "./http.js";

/**
 * Adgangsgrænsen i hele appen er **gruppen**.
 *
 * Der findes præcis én funktion der afgør adgang, og enhver rute der rører
 * gruppedata kalder den. Læg ikke adgangstjek ud i de enkelte handlers.
 *
 * En bruger er medlem af en gruppe hvis der findes en ikke-slettet
 * group_member-række, der peger på en ikke-slettet spiller med brugerens id.
 */
export function isGroupMember(userId: string, groupId: string): boolean {
  const row = db
    .select({ id: groupMember.id })
    .from(groupMember)
    .innerJoin(player, eq(groupMember.playerId, player.id))
    .where(
      and(
        eq(groupMember.groupId, groupId),
        eq(player.userId, userId),
        isNull(groupMember.deletedAt),
        isNull(player.deletedAt),
      ),
    )
    .get();
  return row !== undefined;
}

export function assertGroupAccess(userId: string, groupId: string): void {
  if (!isGroupMember(userId, groupId)) {
    throw forbidden("Du er ikke medlem af den gruppe.");
  }
}

export function userGroupIds(userId: string): string[] {
  return db
    .select({ groupId: groupMember.groupId })
    .from(groupMember)
    .innerJoin(player, eq(groupMember.playerId, player.id))
    .where(
      and(
        eq(player.userId, userId),
        isNull(groupMember.deletedAt),
        isNull(player.deletedAt),
      ),
    )
    .all()
    .map((row) => row.groupId);
}

export function ownPlayerId(userId: string): string | null {
  const row = db
    .select({ id: player.id })
    .from(player)
    .where(and(eq(player.userId, userId), isNull(player.deletedAt)))
    .get();
  return row?.id ?? null;
}

export function groupExists(groupId: string): boolean {
  return (
    db.select({ id: group.id }).from(group).where(eq(group.id, groupId)).get() !==
    undefined
  );
}

export function groupCreator(groupId: string): string | null {
  const row = db
    .select({ updatedBy: group.updatedBy })
    .from(group)
    .where(eq(group.id, groupId))
    .get();
  return row?.updatedBy ?? null;
}

export function groupMemberCount(groupId: string): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(groupMember)
    .where(and(eq(groupMember.groupId, groupId), isNull(groupMember.deletedAt)))
    .get();
  return row?.count ?? 0;
}

export function playGroupId(playId: string): string | null {
  const row = db
    .select({ groupId: play.groupId })
    .from(play)
    .where(eq(play.id, playId))
    .get();
  return row?.groupId ?? null;
}
