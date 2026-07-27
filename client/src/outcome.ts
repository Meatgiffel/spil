import type { OutcomeType } from "@spil/shared";
import type { LocalPlay, LocalPlayParticipant } from "./db/local.js";

/**
 * Hvem vandt et parti.
 *
 * Reglen afhænger af udfaldstypen og bruges tre steder — feed, partidetalje og
 * statistik. Den skal kun findes her, ellers begynder de tre at være uenige.
 */

export const OUTCOME_LABELS: Record<OutcomeType, string> = {
  ranking: "Placeringer",
  score: "Point",
  coop: "Samarbejde",
  teams: "Hold",
  solo: "Solo",
};

export const OUTCOME_HINTS: Record<OutcomeType, string> = {
  ranking: "Tryk spillerne i den rækkefølge de endte.",
  score: "Skriv point ind. Placeringerne regnes ud automatisk.",
  coop: "I spiller sammen mod spillet. Alle vinder eller taber samlet.",
  teams: "Sæt spillerne på hold og vælg hvilket hold der vandt.",
  solo: "Ét menneske mod spillet.",
};

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
    "outcomeType" | "coopResult" | "winningTeam" | "abandoned" | "milestone" | "timeRemainingSeconds"
  >,
  winnerNames: string[],
): string {
  if (play.abandoned) return "Afbrudt";

  const parts: string[] = [];

  switch (play.outcomeType) {
    case "coop":
    case "solo":
      parts.push(
        play.coopResult === "won"
          ? play.outcomeType === "solo"
            ? "Vundet"
            : "Alle vandt"
          : play.coopResult === "lost"
            ? play.outcomeType === "solo"
              ? "Tabt"
              : "Alle tabte"
            : "Intet resultat",
      );
      break;
    case "teams":
      parts.push(play.winningTeam ? `${play.winningTeam} vandt` : "Intet hold noteret");
      break;
    default:
      parts.push(
        winnerNames.length > 0
          ? `${winnerNames.join(" og ")} vandt`
          : "Ingen vinder noteret",
      );
  }

  if (play.milestone) parts.push(play.milestone);
  if (play.timeRemainingSeconds !== null) {
    parts.push(`${formatSeconds(play.timeRemainingSeconds)} tilbage`);
  }

  return parts.join(" · ");
}

export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} sek.`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min.` : `${minutes} min. ${rest} sek.`;
}
