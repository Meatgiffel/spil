import type { Translate } from "./i18n/index.js";

/**
 * Datoer og tal formateres efter det valgte sprog.
 *
 * Locale holdes i et modul-niveau felt frem for at blive tråd gennem hvert
 * eneste kald. Sproget skifter kun ét sted — i LanguageProvider — og alt i
 * app'en gengives alligevel når det sker.
 */
let locale = "en-GB";

export function setLocale(next: string): void {
  locale = next;
}

export function currentLocale(): string {
  return locale;
}

export const formatDate = (ms: number): string =>
  new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(ms));

export const formatShortDate = (ms: number): string =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(ms));

export const formatTime = (ms: number): string =>
  new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(ms),
  );

/** "I dag" / "Today", "I går" / "Yesterday", ellers datoen. */
export function formatDay(ms: number, t: Translate): string {
  const then = new Date(ms);
  const now = new Date();
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return t("time.today");
  if (days === 1) return t("time.yesterday");
  return formatDate(ms);
}

export function formatDuration(minutes: number | null, t: Translate): string | null {
  if (minutes === null || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("time.minutes", { count: rest });
  if (rest === 0) return t("time.hours", { count: hours });
  return t("time.hoursMinutes", { hours, minutes: rest });
}

export function formatSeconds(seconds: number, t: Translate): string {
  if (seconds < 60) return t("time.seconds", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0
    ? t("time.minutesShort", { count: minutes })
    : t("time.minutesSeconds", { minutes, seconds: rest });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Sortering efter det valgte sprog.
 *
 * På dansk skal æ, ø og å bagerst i stedet for at blive blandet ind blandt a,
 * o og aa — det er præcis det localeCompare er til for.
 */
export const byName = <T extends { name: string }>(a: T, b: T): number =>
  a.name.localeCompare(b.name, locale);

export const byTitle = <T extends { title: string }>(a: T, b: T): number =>
  a.title.localeCompare(b.title, locale);

export const compareNames = (a: string, b: string): number => a.localeCompare(b, locale);
