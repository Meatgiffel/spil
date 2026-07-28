// Rene parsere for BoardGameGeeks XML.
//
// Bevidst uden databaseimport: parsningen er det eneste her der kan gå i stykker
// hos os, og den skal kunne testes uden at rejse hverken env eller SQLite.
import { XMLParser } from "fast-xml-parser";
import type { OutcomeType } from "@spil/shared";

export type BggSearchHit = {
  bggId: number;
  title: string;
  year: number | null;
};

export type BggDetails = BggSearchHit & {
  minPlayers: number | null;
  maxPlayers: number | null;
  thumbnailUrl: string | null;
  /** Gættet ud fra spillets mekanikker. Null når intet peger nogen vegne. */
  defaultOutcomeType: OutcomeType | null;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseAttributeValue: true,
});

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

type XmlName = { "@type"?: string; "@value"?: string | number };

function primaryName(name: XmlName | XmlName[] | undefined): string | null {
  const names = asArray(name);
  const primary = names.find((entry) => entry["@type"] === "primary") ?? names[0];
  const value = primary?.["@value"];
  return value === undefined ? null : String(value);
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

/**
 * Mekanik-id'er fra BGG's `boardgamemechanic`-links.
 *
 * Id'erne bruges frem for navnene: BGG omdøber løbende sine mekanikker
 * ("Area Control" blev til "Area Majority / Influence"), men id'et er stabilt.
 */
const MECHANIC_COOPERATIVE = 2023;
const MECHANIC_TEAM_BASED = 2019;

/**
 * Mekanikker der kun optræder når partiet gøres op i point.
 *
 * Listen er bevidst kort. Den skal ramme point-spillene uden at fange alt —
 * "Set Collection" sidder også på Pandemic, så den er kun brugbar fordi
 * samarbejde slår point i rækkefølgen nedenfor.
 */
const MECHANICS_SCORED = new Set([
  2875, // End Game Bonuses
  2987, // Hidden Victory Points
  2080, // Area Majority / Influence
  2004, // Set Collection
]);

/**
 * Bemærk hvad der *ikke* står her: 2819 "Solo / Solitaire Game".
 *
 * Den betyder "har en soloversion", ikke "er et solospil" — den sidder på
 * Wingspan, Pandemic og Gloomhaven. Brugte vi den, ville næsten alle nyere
 * spil defaulte til solo. Solo må brugeren vælge selv.
 */
function outcomeFromMechanics(mechanicIds: Set<number>): OutcomeType | null {
  // Rækkefølgen er prioriteten. Samarbejde først: vinder man sammen, er der
  // hverken placeringer eller hold at tale om, uanset hvad der ellers står.
  if (mechanicIds.has(MECHANIC_COOPERATIVE)) return "coop";
  if (mechanicIds.has(MECHANIC_TEAM_BASED)) return "teams";
  for (const id of MECHANICS_SCORED) {
    if (mechanicIds.has(id)) return "score";
  }
  // Ingen signaler: placeringer er den type der passer på flest spil.
  return null;
}

type XmlLink = { "@type"?: string; "@id"?: string | number };

function mechanicIds(link: XmlLink | XmlLink[] | undefined): Set<number> {
  const ids = new Set<number>();
  for (const entry of asArray(link)) {
    if (entry["@type"] !== "boardgamemechanic") continue;
    const id = toNumber(entry["@id"]);
    if (id !== null) ids.add(id);
  }
  return ids;
}

export function parseSearch(xml: string): BggSearchHit[] {
  const parsed = parser.parse(xml) as {
    items?: { item?: unknown };
  };
  return asArray(parsed.items?.item as Record<string, unknown>[] | undefined)
    .map((item) => {
      const bggId = toNumber(item["@id"]);
      const title = primaryName(item.name as XmlName | XmlName[] | undefined);
      if (bggId === null || !title) return null;
      const year = (item.yearpublished as XmlName | undefined)?.["@value"];
      return { bggId, title, year: year === undefined ? null : toNumber(year) };
    })
    .filter((hit): hit is BggSearchHit => hit !== null);
}

/**
 * Læser et thing-svar med vilkårligt mange emner.
 *
 * BGG tillader `thing?id=1,2,3`, og søgeresultaterne beriges med ét kald frem
 * for ét pr. træffer — deres API er langsomt nok i forvejen.
 */
export function parseThings(xml: string): BggDetails[] {
  const parsed = parser.parse(xml) as { items?: { item?: unknown } };
  return asArray(parsed.items?.item as Record<string, unknown>[] | undefined)
    .map((item) => {
      const bggId = toNumber(item["@id"]);
      const title = primaryName(item.name as XmlName | XmlName[] | undefined);
      if (bggId === null || !title) return null;

      const thumbnail = item.thumbnail;
      return {
        bggId,
        title,
        year: toNumber((item.yearpublished as XmlName | undefined)?.["@value"]),
        minPlayers: toNumber((item.minplayers as XmlName | undefined)?.["@value"]),
        maxPlayers: toNumber((item.maxplayers as XmlName | undefined)?.["@value"]),
        thumbnailUrl: typeof thumbnail === "string" ? thumbnail : null,
        defaultOutcomeType: outcomeFromMechanics(
          mechanicIds(item.link as XmlLink | XmlLink[] | undefined),
        ),
      };
    })
    .filter((details): details is BggDetails => details !== null);
}

export function parseThing(xml: string): BggDetails | null {
  return parseThings(xml)[0] ?? null;
}

