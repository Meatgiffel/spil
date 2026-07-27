import { z } from "zod";

const csv = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(z.string().min(1)));

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(5060),
    DATABASE_PATH: z.string().min(1).default("./dev.db"),
    UPLOADS_DIR: z.string().min(1).default("./uploads"),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, { error: "BETTER_AUTH_SECRET skal være mindst 32 tegn." }),
    // Den udadvendte adresse appen ses på. Bruges til cookies og redirects.
    PUBLIC_URL: z.url().default("http://localhost:5173"),
    TRUSTED_ORIGINS: csv.default([]),
  })
  .superRefine((value, ctx) => {
    // Indkob falder tilbage til AllowAnyOrigin når CORS-konfigurationen mangler.
    // Det er P0 i deres eget hardening-dokument, så her fejler opstarten i stedet.
    if (value.NODE_ENV === "production" && value.TRUSTED_ORIGINS.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["TRUSTED_ORIGINS"],
        message:
          "TRUSTED_ORIGINS skal være sat i produktion. Der er bevidst ingen tillad-alt-fallback.",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(rod)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Ugyldig konfiguration:\n${details}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";

// I produktion står appen bag nginx i containeren og nginxproxymanager udenfor.
// Uden trusted origins ville secure-cookien aldrig blive sat.
export const trustedOrigins =
  env.TRUSTED_ORIGINS.length > 0 ? env.TRUSTED_ORIGINS : [env.PUBLIC_URL];
