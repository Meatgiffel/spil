import type { OutcomeType } from "@spil/shared";
import type { LocalPlay, LocalPlayParticipant } from "./db/local.js";
import { formatSeconds } from "./format.js";
import type { MessageKey, Translate } from "./i18n/index.js";

/**
 * Hvem vandt et parti.
 *
 * Reglen afhænger af udfaldstypen og bruges tre steder — feed, partidetalje og
 * statistik. Den skal kun findes her, ellers begynder de tre at være uenige.
 */

export const outcomeLabelKey = (type: OutcomeType): MessageKey =>
  `outcome.${type}` as MessageKey;

export const outcomeHintKey = (type: OutcomeType): MessageKey =>
  `outcome.hint.${type}` as MessageKey;

/** Laveste placeringstal blandt deltagerne, eller null hvis ingen er placeret. */
export function bestPlacement(
  participants: Pick<LocalPlayParticipant, "placement">[],
): number | null {
  return participants.reduce<number | null>(
    (lowest, row) =>
      row.placement === null
        ? lowest
        : lowest === null
          ? row.placement
          : Math.min(lowest, row.placement),
    null,
  );
}

export function isWinner(
  play: Pick<LocalPlay, "outcomeType" | "coopResult" | "winningTeam" | "abandoned">,
  participant: Pick<LocalPlayParticipant, "placement" | "team">,
  best: number | null,
): boolean {
  // Et afbrudt parti har ingen vinder, uanset hvad der ellers står i rækkerne.
  if (play.abandoned) return false;

  switch (play.outcomeType) {
    case "coop":
    case "solo":
      // Alle vinder eller taber samlet.
      return play.coopResult === "won";
    case "teams":
      return participant.team !== null && participant.team === play.winningTeam;
    default:
      return participant.placement !== null && participant.placement === best;
  }
}

/**
 * Udregner placeringer ud fra point.
 *
 * Ens point giver samme placering, og den næste placering springer frem — som i
 * sport: 1, 1, 3. `lowScoreWins` dækker 6 nimmt!, golf og lignende.
 */
export function placementsFromScores(
  scores: Map<string, number | null>,
  lowScoreWins: boolean,
): Map<string, number | null> {
  const scored = [...scores.entries()].filter(
    (entry): entry is [string, number] => entry[1] !== null,
  );
  scored.sort((a, b) => (lowScoreWins ? a[1] - b[1] : b[1] - a[1]));

  const result = new Map<string, number | null>();
  for (const [playerId] of scores) result.set(playerId, null);

  let placement = 0;
  let previousScore: number | null = null;
  scored.forEach(([playerId, score], index) => {
    if (previousScore === null || score !== previousScore) {
      placement = index + 1;
      previousScore = score;
    }
    result.set(playerId, placement);
  });

  return result;
}

/** Kort resumé til feed og lister. */
export function outcomeSummary(
  play: Pick<
    LocalPlay,
    | "outcomeType"
    | "coopResult"
    | "winningTeam"
    | "abandoned"
    | "milestone"
    | "timeRemainingSeconds"
  >,
  winnerNames: string[],
  t: Translate,
): string {
  if (play.abandoned) return t("outcome.abandoned");

  const parts: string[] = [];

  switch (play.outcomeType) {
    case "coop":
    case "solo": {
      const solo = play.outcomeType === "solo";
      parts.push(
        play.coopResult === "won"
          ? t(solo ? "outcome.soloWon" : "outcome.everyoneWon")
          : play.coopResult === "lost"
            ? t(solo ? "outcome.soloLost" : "outcome.everyoneLost")
            : t("outcome.noResult"),
      );
      break;
    }
    case "teams":
      parts.push(
        play.winningTeam
          ? t("outcome.teamWon", { team: play.winningTeam })
          : t("outcome.noTeam"),
      );
      break;
    default:
      parts.push(
        winnerNames.length > 0
          ? t("outcome.playersWon", { names: joinNames(winnerNames, t) })
          : t("outcome.noWinner"),
      );
  }

  if (play.milestone) parts.push(play.milestone);
  if (play.timeRemainingSeconds !== null) {
    parts.push(t("outcome.timeLeft", { time: formatSeconds(play.timeRemainingSeconds, t) }));
  }

  return parts.join(" · ");
}

/** "Ida og Sofie" / "Ida and Sofie". Intl klarer sprogforskellen. */
function joinNames(names: string[], t: Translate): string {
  return new Intl.ListFormat(t.locale, { style: "long", type: "conjunction" }).format(
    names,
  );
}
