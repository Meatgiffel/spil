// Rene parsere for BoardGameGeeks XML.
//
// Bevidst uden databaseimport: parsningen er det eneste her der kan gå i stykker
// hos os, og den skal kunne testes uden at rejse hverken env eller SQLite.
import { XMLParser } from "fast-xml-parser";


export type BggSearchHit = {
  bggId: number;
  title: string;
  year: number | null;
};

export type BggDetails = BggSearchHit & {
  minPlayers: number | null;
  maxPlayers: number | null;
  thumbnailUrl: string | null;
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

export function parseThing(xml: string): BggDetails | null {
  const parsed = parser.parse(xml) as { items?: { item?: unknown } };
  const item = asArray(parsed.items?.item as Record<string, unknown>[] | undefined)[0];
  if (!item) return null;

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
  };
}

