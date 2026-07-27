import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../env.js";
import { schema } from "./schema.js";

export function openSqlite(databasePath: string): Database.Database {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const sqlite = new Database(databasePath);
  // WAL gør læsninger samtidige med skrivninger og er en forudsætning for at
  // VACUUM INTO-backuppen kan tages mens servicen kører.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return sqlite;
}

export const sqlite: Database.Database = openSqlite(env.DATABASE_PATH);

export const db = drizzle(sqlite, { schema });

export type Db = typeof db;
