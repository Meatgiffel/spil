const dateFormat = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortDateFormat = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
});

const timeFormat = new Intl.DateTimeFormat("da-DK", {
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDate = (ms: number): string => dateFormat.format(new Date(ms));
export const formatShortDate = (ms: number): string => shortDateFormat.format(new Date(ms));
export const formatTime = (ms: number): string => timeFormat.format(new Date(ms));

/** "I dag", "I går", ellers datoen. */
export function formatDay(ms: number): string {
  const then = new Date(ms);
  const now = new Date();
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return "I dag";
  if (days === 1) return "I går";
  return formatDate(ms);
}

export function formatDuration(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min.`;
  if (rest === 0) return `${hours} t.`;
  return `${hours} t. ${rest} min.`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Dansk sortering — æ, ø og å skal ligge bagerst, ikke blandet ind blandt a, o og aa. */
export const byName = <T extends { name: string }>(a: T, b: T): number =>
  a.name.localeCompare(b.name, "da");

export function placementLabel(placement: number | null): string {
  if (placement === null) return "—";
  return `${placement}.`;
}

/** "3 spillere", "1 spiller" */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
