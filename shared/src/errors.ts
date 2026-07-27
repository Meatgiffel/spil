/**
 * Stabile fejlkoder.
 *
 * Serveren sender en kode ved siden af teksten, og klienten oversætter den til
 * brugerens sprog. Teksten fra serveren er stadig læsbar — den bruges som
 * fallback for koder klienten ikke kender, fx efter en delvis opdatering hvor
 * serveren er nyere end den app der ligger i browserens cache.
 *
 * Koderne må aldrig ændre betydning. Skal en formulering rettes, rettes
 * oversættelsen — ikke koden.
 */
export const ERROR_CODES = [
  // Generelt
  "unknown",
  "validation",
  "not_found",
  "unauthorized",
  "forbidden",
  "no_connection",
  "session_expired",

  // Konto og login
  "email_taken",
  "email_invalid",
  "name_required",
  "name_too_long",
  "password_min",
  "password_max",
  "invite_key_format",
  "invite_key_invalid",
  "invite_key_missing",
  "admin_required",

  // Grupper og partier
  "not_group_member",
  "group_missing",
  "play_missing",
  "play_not_found",
  "player_other_account",
  "player_claims_other_account",
  "id_mismatch",

  // Filer
  "file_missing",
  "file_type",
  "photo_rejected",

  // BoardGameGeek
  "bgg_not_configured",
  "bgg_rejected_token",
  "bgg_unavailable",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Dansk fallback-tekst. Bruges som `message` i API-svaret, så et rå kald mod
 * API'et stadig kan læses af et menneske.
 */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  unknown: "Der gik noget galt.",
  validation: "Nogle felter er ikke udfyldt rigtigt.",
  not_found: "Blev ikke fundet.",
  unauthorized: "Du er ikke logget ind.",
  forbidden: "Du har ikke adgang til det her.",
  no_connection: "Ingen forbindelse.",
  session_expired: "Din session er udløbet.",

  email_taken: "Der findes allerede en konto med den e-mailadresse.",
  email_invalid: "Indtast en gyldig e-mailadresse.",
  name_required: "Navnet må ikke være tomt.",
  name_too_long: "Navnet er for langt.",
  password_min: "Kodeordet skal være mindst 6 tegn.",
  password_max: "Kodeordet er for langt.",
  invite_key_format: "Invitationsnøglen har ikke det rigtige format.",
  invite_key_invalid: "Invitationsnøglen er ikke gyldig.",
  invite_key_missing: "Der skal en invitationsnøgle til.",
  admin_required: "Kræver en administratorkonto.",

  not_group_member: "Du er ikke medlem af den gruppe.",
  group_missing: "Der mangler en gruppe.",
  play_missing: "Der mangler et parti.",
  play_not_found: "Partiet findes ikke.",
  player_other_account: "Spilleren tilhører en anden konto.",
  player_claims_other_account: "Du kan ikke knytte en spiller til en anden konto.",
  id_mismatch: "Id'et matcher ikke.",

  file_missing: "Der var ingen fil med.",
  file_type: "Filtypen understøttes ikke. Brug JPEG, PNG, WebP eller HEIC.",
  photo_rejected: "Billedet blev afvist af serveren.",

  bgg_not_configured: "BoardGameGeek-opslag er ikke sat op. Der mangler et API-token.",
  bgg_rejected_token: "BoardGameGeek afviste API-tokenet.",
  bgg_unavailable: "BoardGameGeek svarer ikke lige nu. Opret spillet manuelt i stedet.",
};

export function errorText(code: ErrorCode): string {
  return ERROR_TEXT[code] ?? ERROR_TEXT.unknown;
}
