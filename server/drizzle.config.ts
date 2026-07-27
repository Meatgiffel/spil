import { defineConfig } from "drizzle-kit";

// Skemaændring = ret src/db/schema.ts → drizzle-kit generate → commit migrationen.
// Skriv aldrig rå CREATE TABLE ved siden af.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "./dev.db",
  },
  strict: true,
  verbose: true,
});
