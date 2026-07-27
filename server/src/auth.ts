import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { db } from "./db/client.js";
import {
  account,
  rateLimit,
  session,
  user,
  verification,
} from "./db/schema.js";
import { env, isProduction, trustedOrigins } from "./env.js";

const DAY = 60 * 60 * 24;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: { user, session, account, verification, rateLimit },
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.PUBLIC_URL,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    // Selve oprettelsen går gennem POST /api/signup, som håndhæver invitationsnøglen.
    // Better Auths eget sign-up-endpoint blokeres i routes/auth.ts.
    minPasswordLength: 10,
    maxPasswordLength: 200,
    requireEmailVerification: false,
  },
  session: {
    // 30 dage med glidende fornyelse, så app'en åbner logget ind uden net.
    expiresIn: DAY * 30,
    updateAge: DAY,
  },
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
    ipAddress: {
      // Uden det her kan Better Auth ikke se hvem der kalder, og rate-limiteren
      // falder tilbage til én fælles spand for alle brugere — så ét mislykket
      // login-stormløb ville ramme alle andre.
      //
      // nginx i containeren sætter X-Forwarded-For, og API'et lytter kun på
      // 127.0.0.1, så headeren kan ikke sættes udefra.
      ipAddressHeaders: ["x-forwarded-for"],
    },
  },
  rateLimit: {
    enabled: true,
    // Databaselagring, så login-forsøg tælles på tværs af genstarter.
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 900, max: 10 },
    },
  },
  plugins: [admin()],
});

export type AuthSession = typeof auth.$Infer.Session;
