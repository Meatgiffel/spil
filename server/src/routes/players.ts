import { Router } from "express";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { linkPlayerSchema } from "@spil/shared";
import { isGroupMember } from "../access.js";
import { db } from "../db/client.js";
import { groupMember, playParticipant, player, user } from "../db/schema.js";
import { HttpError, forbidden, notFound, parseOrThrow } from "../http.js";
import { requireUser } from "../session.js";
import { allocateServerSeq } from "../sync.js";

export const playersRouter: Router = Router();

playersRouter.use(requireUser);

/**
 * Alle konti med deres spiller.
 *
 * Klienten kan ikke selv finde dem: en spiller synkroniseres først når man
 * deler gruppe, og man skal netop kunne finde nogen man *ikke* deler gruppe med
 * endnu for at tilføje dem. Derfor et opslag der går uden om sync.
 *
 * Installationen er lukket bag invitationsnøgler, så alle brugere kender
 * hinanden i forvejen — navn og e-mail er ikke en oplysning der skal skjules
 * for dem der allerede er lukket ind.
 */
playersRouter.get("/accounts", (_req, res) => {
  const rows = db
    .select({
      playerId: player.id,
      userId: player.userId,
      name: player.name,
      email: user.email,
    })
    .from(player)
    .innerJoin(user, eq(player.userId, user.id))
    .where(and(isNotNull(player.userId), isNull(player.deletedAt)))
    .all();

  res.json({ accounts: rows });
});

/**
 * Lægger en gæst sammen med en konto.
 *
 * Hver konto har præcis én spiller — der er et unikt indeks på user_id — så
 * koblingen kan ikke være "sæt user_id på gæsten". Den er en sammenlægning:
 * gæstens partier og medlemskaber flyttes over på kontoens spiller, og gæsten
 * soft-slettes.
 *
 * Går bevidst uden om sync. Den kræver begge spilleres fulde historik og skal
 * være atomisk, og ingen af delene kan lade sig gøre på en offline klient.
 */
playersRouter.post("/:playerId/link", (req, res) => {
  const { targetPlayerId } = parseOrThrow(linkPlayerSchema, req.body ?? {});
  const guestId = req.params.playerId;
  const userId = req.user!.id;

  const guest = db.select().from(player).where(eq(player.id, guestId)).get();
  if (!guest || guest.deletedAt !== null) throw notFound("player_not_found");
  if (guest.userId !== null) throw new HttpError(409, "player_not_guest");

  const target = db.select().from(player).where(eq(player.id, targetPlayerId)).get();
  if (!target || target.deletedAt !== null) throw notFound("player_not_found");
  if (target.userId === null) throw new HttpError(409, "target_not_account");
  if (target.id === guest.id) throw new HttpError(409, "target_not_account");

  // Gæsten kan være med i flere grupper. Må man kun den ene, kan man ikke
  // omskrive historik i de andre.
  const guestGroups = db
    .select({ groupId: groupMember.groupId })
    .from(groupMember)
    .where(and(eq(groupMember.playerId, guestId), isNull(groupMember.deletedAt)))
    .all()
    .map((row) => row.groupId);

  if (!guestGroups.every((groupId) => isGroupMember(userId, groupId))) {
    throw forbidden("link_needs_all_groups");
  }

  const now = Date.now();

  db.transaction(() => {
    // Ét sekvensnummer til hele sammenlægningen — den skal enten være helt inde
    // eller helt ude, set fra en klients cursor.
    const serverSeq = allocateServerSeq();
    const meta = { updatedAt: now, serverSeq, updatedBy: userId };

    // ── Partier ───────────────────────────────────────────────────────────
    const guestParticipations = db
      .select()
      .from(playParticipant)
      .where(and(eq(playParticipant.playerId, guestId), isNull(playParticipant.deletedAt)))
      .all();

    const targetPlayIds = new Set(
      db
        .select({ playId: playParticipant.playId })
        .from(playParticipant)
        .where(
          and(eq(playParticipant.playerId, target.id), isNull(playParticipant.deletedAt)),
        )
        .all()
        .map((row) => row.playId),
    );

    for (const row of guestParticipations) {
      if (targetPlayIds.has(row.playId)) {
        // Begge var med i samme parti — som gæst og som konto. Det unikke
        // indeks på (play_id, player_id) tillader ikke to rækker, og kontoens
        // er den rigtige at beholde.
        db.update(playParticipant)
          .set({ ...meta, deletedAt: now })
          .where(eq(playParticipant.id, row.id))
          .run();
      } else {
        db.update(playParticipant)
          .set({ ...meta, playerId: target.id })
          .where(eq(playParticipant.id, row.id))
          .run();
      }
    }

    // ── Medlemskaber ──────────────────────────────────────────────────────
    const targetGroups = new Set(
      db
        .select({ groupId: groupMember.groupId })
        .from(groupMember)
        .where(and(eq(groupMember.playerId, target.id), isNull(groupMember.deletedAt)))
        .all()
        .map((row) => row.groupId),
    );

    const guestMemberships = db
      .select()
      .from(groupMember)
      .where(and(eq(groupMember.playerId, guestId), isNull(groupMember.deletedAt)))
      .all();

    for (const row of guestMemberships) {
      // Gæstens medlemskab soft-slettes altid frem for at blive flyttet.
      //
      // Det er ikke kosmetik: pull viser en spiller til dem der deler gruppe
      // med vedkommende, og det opslag går gennem group_member. Flyttede vi
      // rækken, ville intet længere pege på gæsten, og sletningen af gæsten
      // kunne aldrig nå ud til klienterne — de ville beholde en død spiller
      // for evigt. Den soft-slettede række holder gæsten synlig præcis længe
      // nok til at forsvinde ordentligt.
      db.update(groupMember)
        .set({ ...meta, deletedAt: now })
        .where(eq(groupMember.id, row.id))
        .run();

      if (!targetGroups.has(row.groupId)) {
        db.insert(groupMember)
          .values({
            id: uuidv7(),
            groupId: row.groupId,
            playerId: target.id,
            role: row.role,
            deletedAt: null,
            ...meta,
          })
          .run();
        targetGroups.add(row.groupId);
      }
    }

    // ── Gæsten selv ───────────────────────────────────────────────────────
    // Soft delete, ikke hard: klienterne skal have at vide at rækken er væk.
    db.update(player)
      .set({ ...meta, deletedAt: now })
      .where(eq(player.id, guestId))
      .run();

    // Navnet fra gæsten beholdes ikke — kontoen har sit eget. Men den skal
    // have nyt sekvensnummer, så klienterne henter den sammen med resten.
    db.update(player).set(meta).where(eq(player.id, target.id)).run();
  });

  res.json({ status: "ok", playerId: target.id });
});
