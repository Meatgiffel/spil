import { describe, expect, it } from "vitest";
import type { OutcomeType } from "@spil/shared";
import { createTranslate } from "./i18n/index.js";
import { bestPlacement, isWinner, outcomeSummary, placementsFromScores } from "./outcome.js";

const en = createTranslate("en");
const da = createTranslate("da");

// Den bredeste af de to signaturer, så samme hjælper kan bruges til begge.
// isWinner tager en delmængde af felterne og accepterer derfor objektet.
type PlayLike = Parameters<typeof outcomeSummary>[0];
type ParticipantLike = Parameters<typeof isWinner>[1];

const play = (patch: Partial<PlayLike> = {}): PlayLike => ({
  outcomeType: "ranking" as OutcomeType,
  coopResult: null,
  winningTeam: null,
  abandoned: false,
  milestone: null,
  timeRemainingSeconds: null,
  ...patch,
});

const p = (patch: Partial<ParticipantLike> = {}): ParticipantLike => ({
  placement: null,
  team: null,
  ...patch,
});

describe("hvem vandt", () => {
  it("rangering: laveste placering vinder", () => {
    const participants = [p({ placement: 2 }), p({ placement: 1 }), p({ placement: 3 })];
    const best = bestPlacement(participants);
    expect(best).toBe(1);
    expect(participants.map((row) => isWinner(play(), row, best))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("rangering: uafgjort giver to vindere", () => {
    const participants = [p({ placement: 1 }), p({ placement: 1 }), p({ placement: 3 })];
    const best = bestPlacement(participants);
    expect(participants.filter((row) => isWinner(play(), row, best))).toHaveLength(2);
  });

  it("samarbejde: alle vinder eller ingen", () => {
    const vundet = play({ outcomeType: "coop", coopResult: "won" });
    const tabt = play({ outcomeType: "coop", coopResult: "lost" });
    expect(isWinner(vundet, p(), null)).toBe(true);
    expect(isWinner(tabt, p(), null)).toBe(false);
  });

  it("hold: kun det vindende hold tæller", () => {
    const holdspil = play({ outcomeType: "teams", winningTeam: "Hold 2" });
    expect(isWinner(holdspil, p({ team: "Hold 2" }), null)).toBe(true);
    expect(isWinner(holdspil, p({ team: "Hold 1" }), null)).toBe(false);
    // Uden hold kan man ikke vinde et holdspil.
    expect(isWinner(holdspil, p({ team: null }), null)).toBe(false);
  });

  it("afbrudt parti har ingen vinder, uanset hvad rækkerne siger", () => {
    const afbrudt = play({ abandoned: true, coopResult: "won", winningTeam: "Hold 1" });
    expect(isWinner(afbrudt, p({ placement: 1 }), 1)).toBe(false);
    expect(isWinner({ ...afbrudt, outcomeType: "coop" }, p(), null)).toBe(false);
    expect(
      isWinner({ ...afbrudt, outcomeType: "teams" }, p({ team: "Hold 1" }), null),
    ).toBe(false);
  });
});

describe("placeringer ud fra point", () => {
  it("flest point vinder", () => {
    const result = placementsFromScores(
      new Map([
        ["a", 42],
        ["b", 97],
        ["c", 61],
      ]),
      false,
    );
    expect(result.get("b")).toBe(1);
    expect(result.get("c")).toBe(2);
    expect(result.get("a")).toBe(3);
  });

  it("færrest point vinder for spil som 6 nimmt!", () => {
    const result = placementsFromScores(
      new Map([
        ["a", 42],
        ["b", 97],
        ["c", 12],
      ]),
      true,
    );
    expect(result.get("c")).toBe(1);
    expect(result.get("a")).toBe(2);
    expect(result.get("b")).toBe(3);
  });

  it("ens point deler placering, og den næste springer frem", () => {
    // Som i sport: 1, 1, 3 — ikke 1, 1, 2.
    const result = placementsFromScores(
      new Map([
        ["a", 50],
        ["b", 50],
        ["c", 10],
      ]),
      false,
    );
    expect(result.get("a")).toBe(1);
    expect(result.get("b")).toBe(1);
    expect(result.get("c")).toBe(3);
  });

  it("spillere uden point får ingen placering", () => {
    const result = placementsFromScores(
      new Map([
        ["a", 10],
        ["b", null],
      ]),
      false,
    );
    expect(result.get("a")).toBe(1);
    expect(result.get("b")).toBeNull();
  });
});

describe("resumé til feed", () => {
  it("nævner vinderen ved rangering", () => {
    expect(outcomeSummary(play(), ["Ida"], en)).toBe("Ida won");
    expect(outcomeSummary(play(), ["Ida"], da)).toBe("Ida vandt");
  });

  it("binder flere vindere sammen på sprogets egen måde", () => {
    expect(outcomeSummary(play(), ["Ida", "Sofie"], en)).toBe("Ida and Sofie won");
    expect(outcomeSummary(play(), ["Ida", "Sofie"], da)).toBe("Ida og Sofie vandt");
  });

  it("tager milepæl og resttid med ved samarbejde", () => {
    const coop = play({
      outcomeType: "coop",
      coopResult: "lost",
      milestone: "Boss 4",
      timeRemainingSeconds: 7,
    });
    expect(outcomeSummary(coop, [], en)).toBe("Everyone lost · Boss 4 · 7 sec left");
    expect(outcomeSummary(coop, [], da)).toBe("Alle tabte · Boss 4 · 7 sek. tilbage");
  });

  it("formaterer minutter når der er mere end et minut tilbage", () => {
    const coop = play({
      outcomeType: "coop",
      coopResult: "won",
      timeRemainingSeconds: 125,
    });
    expect(outcomeSummary(coop, [], en)).toBe("Everyone won · 2 min 5 sec left");
    expect(outcomeSummary(coop, [], da)).toBe("Alle vandt · 2 min. 5 sek. tilbage");
  });

  it("siger afbrudt og intet andet", () => {
    const abandoned = play({ abandoned: true, milestone: "Boss 4" });
    expect(outcomeSummary(abandoned, ["Ida"], en)).toBe("Abandoned");
    expect(outcomeSummary(abandoned, ["Ida"], da)).toBe("Afbrudt");
  });
});
