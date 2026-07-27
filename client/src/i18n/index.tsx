import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setLocale } from "../format.js";
import { da, en, type MessageKey } from "./messages.js";

export const LANGUAGES = ["en", "da"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  da: "Dansk",
};

/** Intl-locale pr. sprog. en-GB frem for en-US: dag før måned, som i Danmark. */
export const LOCALES: Record<Language, string> = {
  en: "en-GB",
  da: "da-DK",
};

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { en, da };

const LANGUAGE_KEY = "spil.language";

/**
 * Uden et gemt valg falder vi tilbage på engelsk. Browserens sprog bruges
 * *ikke* til at gætte: appen er engelsk som udgangspunkt, og den der vil have
 * dansk vælger det én gang.
 */
export const DEFAULT_LANGUAGE: Language = "en";

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Sproget ligger i localStorage, ikke i IndexedDB.
 *
 * To grunde. For det første er localStorage synkront: sproget er kendt allerede
 * ved første render, så der ikke er et glimt af engelsk mens en asynkron
 * læsning svarer — og et genindlæs lige efter et valg kan ikke nå at afbryde
 * skrivningen, som det kunne med Dexie.
 *
 * For det andet er sproget en indstilling for *enheden*, ikke data der hører
 * til kontoen. Det skal derfor overleve et log ud, hvor al lokal data ryddes —
 * ellers ville login-skærmen skifte sprog bag om brugeren.
 */
function readStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    // Privat browsing kan afvise localStorage. Sproget er ikke vigtigt nok
    // til at vælte app'en over.
    return DEFAULT_LANGUAGE;
  }
}

function storeLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    /* ignoreres bevidst — se ovenfor */
  }
}

type Params = Record<string, string | number>;

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export type Translate = {
  (key: MessageKey, params?: Params): string;
  /** Vælger `key_one` eller `key_other` ud fra antallet og indsætter {count}. */
  count(key: string, count: number, params?: Params): string;
  language: Language;
  locale: string;
};

/**
 * Bygger en oversætter for et sprog.
 *
 * Ligger uden for komponenten, så tests kan bruge præcis den samme funktion som
 * app'en i stedet for en efterligning der kan komme ud af trit.
 */
export function createTranslate(language: Language): Translate {
  const dictionary = DICTIONARIES[language];

  const translate = ((key: MessageKey, params?: Params) =>
    interpolate(dictionary[key] ?? key, params)) as Translate;

  translate.count = (key: string, count: number, params?: Params) => {
    const suffix = count === 1 ? "_one" : "_other";
    const withCount = `${key}${suffix}` as MessageKey;
    const template = dictionary[withCount] ?? dictionary[key as MessageKey] ?? key;
    return interpolate(template, { count, ...params });
  };

  translate.language = language;
  translate.locale = LOCALES[language];
  return translate;
}

type LanguageValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
};

const LanguageContext = createContext<LanguageValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Læses synkront ved første render, så der aldrig vises et forkert sprog.
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  useEffect(() => {
    // Skærmlæsere og browserens oversættelse retter sig efter lang-attributten.
    document.documentElement.lang = language;
    setLocale(LOCALES[language]);
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    storeLanguage(next);
  }, []);

  const t = useMemo(() => createTranslate(language), [language]);

  return (
    <LanguageContext value={{ language, setLanguage, t }}>{children}</LanguageContext>
  );
}

export function useLanguage(): LanguageValue {
  const value = use(LanguageContext);
  if (!value) throw new Error("useLanguage skal bruges inde i LanguageProvider.");
  return value;
}

export function useT(): Translate {
  return useLanguage().t;
}

/**
 * Oversætter en fejlkode fra serveren.
 *
 * Ukendte koder falder tilbage på serverens egen tekst — det sker fx hvis
 * serveren er nyere end den app der ligger i browserens cache.
 */
export function translateError(
  t: Translate,
  code: string | undefined,
  fallback: string,
): string {
  if (!code) return fallback;
  const key = `errors.${code}` as MessageKey;
  const translated = t(key);
  return translated === key ? fallback : translated;
}

export type { MessageKey };
