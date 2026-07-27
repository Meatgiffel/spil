import { db, type LocalPlay, type LocalPlayer } from "./local.js";
import { byName } from "../format.js";

/**
 * Alle forespørgsler filtrerer soft-slettede rækker fra. Rækkerne bliver
 * liggende lokalt, fordi sletningen skal kunne synkes — men de må aldrig vises.
 */
const alive = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
  rows.filter((row) => row.deletedAt === null);

export async function listGroups() {
  return alive(await db.group.toArray()).sort(byName);
}

export async function getGroup(groupId: string) {
  const row = await db.group.get(groupId);
  return row && row.deletedAt === null ? row : undefined;
}

export async function listGroupPlayers(groupId: string): Promise<LocalPlayer[]> {
  const members = alive(await db.groupMember.where("groupId").equals(groupId).toArray());
  const players = await db.player.bulkGet(members.map((member) => member.playerId));
  return alive(players.filter((player): player is LocalPlayer => player !== undefined)).sort(
    byName,
  );
}

export async function listPlays(groupId?: string): Promise<LocalPlay[]> {
  const rows = groupId
    ? await db.play.where("groupId").equals(groupId).toArray()
    : await db.play.toArray();
  return alive(rows).sort((a, b) => b.playedAt - a.playedAt);
}

export async function getPlay(playId: string) {
  const row = await db.play.get(playId);
  return row && row.deletedAt === null ? row : undefined;
}

export async function listParticipants(playId: string) {
  const rows = alive(await db.playParticipant.where("playId").equals(playId).toArray());
  const players = await db.player.bulkGet(rows.map((row) => row.playerId));
  return rows
    .map((row, index) => ({ ...row, player: players[index] }))
    .sort((a, b) => {
      // Uden placering (co-op) sorteres på navn; ellers på placering.
      if (a.placement === null && b.placement === null) {
        return (a.player?.name ?? "").localeCompare(b.player?.name ?? "", "da");
      }
      if (a.placement === null) return 1;
      if (b.placement === null) return -1;
      return a.placement - b.placement;
    });
}

export type PhotoView = {
  id: string;
  /** Serversti når billedet er uploadet, ellers en blob-URL fra IndexedDB. */
  src: string;
  pending: boolean;
};

/**
 * Billeder til et parti — både de uploadede og dem der stadig venter.
 *
 * Blob-URL'erne skal frigives igen af kalderen, ellers lækker de hukommelse.
 */
export async function listPhotos(playId: string): Promise<PhotoView[]> {
  const uploaded = alive(await db.photo.where("playId").equals(playId).toArray());
  const waiting = await db.blobs.where("playId").equals(playId).toArray();

  return [
    ...uploaded.map((row) => ({ id: row.id, src: row.filePath, pending: false })),
    ...waiting.map((row) => ({
      id: row.id,
      src: URL.createObjectURL(row.blob),
      pending: true,
    })),
  ];
}

export async function listGames() {
  return alive(await db.game.toArray()).sort((a, b) => a.title.localeCompare(b.title, "da"));
}

export async function getGame(gameId: string) {
  const row = await db.game.get(gameId);
  return row && row.deletedAt === null ? row : undefined;
}

export async function ownPlayer(userId: string): Promise<LocalPlayer | undefined> {
  const rows = await db.player.where("userId").equals(userId).toArray();
  return alive(rows)[0];
}

export type PlaySummary = LocalPlay & {
  gameTitle: string;
  groupName: string;
  winners: string[];
  participantCount: number;
};

/** Bruges til feeds. Slår spil, gruppe og vindere op i én omgang. */
export async function summarisePlays(plays: LocalPlay[]): Promise<PlaySummary[]> {
  if (plays.length === 0) return [];

  const games = await db.game.bulkGet([...new Set(plays.map((play) => play.gameId))]);
  const gameTitles = new Map(
    games.filter((game) => game !== undefined).map((game) => [game.id, game.title]),
  );

  const groups = await db.group.bulkGet([...new Set(plays.map((play) => play.groupId))]);
  const groupNames = new Map(
    groups.filter((group) => group !== undefined).map((group) => [group.id, group.name]),
  );

  const playIds = new Set(plays.map((play) => play.id));
  const participants = alive(
    await db.playParticipant.where("playId").anyOf([...playIds]).toArray(),
  );
  const players = await db.player.bulkGet([
    ...new Set(participants.map((row) => row.playerId)),
  ]);
  const playerNames = new Map(
    players.filter((row) => row !== undefined).map((row) => [row.id, row.name]),
  );

  return plays.map((play) => {
    const mine = participants.filter((row) => row.playId === play.id);
    const best = mine.reduce<number | null>(
      (lowest, row) =>
        row.placement === null ? lowest : lowest === null ? row.placement : Math.min(lowest, row.placement),
      null,
    );
    const winners =
      best === null
        ? []
        : mine
            .filter((row) => row.placement === best)
            .map((row) => playerNames.get(row.playerId) ?? "Ukendt");

    return {
      ...play,
      gameTitle: gameTitles.get(play.gameId) ?? "Ukendt spil",
      groupName: groupNames.get(play.groupId) ?? "Ukendt gruppe",
      winners,
      participantCount: mine.length,
    };
  });
}

export type PlayerStat = {
  playerId: string;
  name: string;
  plays: number;
  wins: number;
};

export async function groupStats(groupId: string): Promise<{
  players: PlayerStat[];
  topGames: { gameId: string; title: string; count: number }[];
  totalPlays: number;
}> {
  const plays = await listPlays(groupId);
  const participants = alive(
    await db.playParticipant.where("playId").anyOf(plays.map((play) => play.id)).toArray(),
  );

  const bestByPlay = new Map<string, number>();
  for (const row of participants) {
    if (row.placement === null) continue;
    const current = bestByPlay.get(row.playId);
    if (current === undefined || row.placement < current) {
      bestByPlay.set(row.playId, row.placement);
    }
  }

  const tally = new Map<string, { plays: number; wins: number }>();
  for (const row of participants) {
    const entry = tally.get(row.playerId) ?? { plays: 0, wins: 0 };
    entry.plays += 1;
    if (row.placement !== null && bestByPlay.get(row.playId) === row.placement) {
      entry.wins += 1;
    }
    tally.set(row.playerId, entry);
  }

  const players = await db.player.bulkGet([...tally.keys()]);
  const names = new Map(
    players.filter((row) => row !== undefined).map((row) => [row.id, row.name]),
  );

  const gameCounts = new Map<string, number>();
  for (const play of plays) {
    gameCounts.set(play.gameId, (gameCounts.get(play.gameId) ?? 0) + 1);
  }
  const games = await db.game.bulkGet([...gameCounts.keys()]);
  const gameTitles = new Map(
    games.filter((game) => game !== undefined).map((game) => [game.id, game.title]),
  );

  return {
    players: [...tally.entries()]
      .map(([playerId, entry]) => ({
        playerId,
        name: names.get(playerId) ?? "Ukendt",
        ...entry,
      }))
      .sort((a, b) => b.wins - a.wins || b.plays - a.plays || byName(a, b)),
    topGames: [...gameCounts.entries()]
      .map(([gameId, count]) => ({
        gameId,
        title: gameTitles.get(gameId) ?? "Ukendt spil",
        count,
      }))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "da"))
      .slice(0, 5),
    totalPlays: plays.length,
  };
}
