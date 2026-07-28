/**
 * Versionen på den bygning der kører lige nu.
 *
 * Bages ind under bygningen frem for at blive hentet fra `/version.json`.
 * To grunde: det virker offline, og det er det ærlige svar på spørgsmålet.
 * Service worker'en serverer den app-shell den har liggende, så serveren kan
 * sagtens være nyere end det man selv har åbent — og det er netop dét man vil
 * kunne se, når man tjekker om opdateringen er landet på telefonen.
 *
 * Værdierne sættes af scripts/release.sh. I udvikling er de ikke sat.
 */
const value = (name: string): string | null => {
  const raw = import.meta.env[name];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

export const APP_VERSION = value("VITE_APP_VERSION") ?? "dev";
export const APP_COMMIT = value("VITE_APP_COMMIT");

const builtAt = Number(value("VITE_APP_BUILT_AT"));
export const APP_BUILT_AT = Number.isFinite(builtAt) && builtAt > 0 ? builtAt : null;
