import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./client.js";
import { syncSeq } from "./schema.js";

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

export function runMigrations(): void {
  migrate(db, { migrationsFolder });
  // Sekvenstælleren skal findes som præcis én række. Det er data, ikke skema,
  // så den seedes her i stedet for i migrationen.
  db.insert(syncSeq).values({ id: 1, value: 0 }).onConflictDoNothing().run();
}

// Kør migrations direkte: npm run db:migrate
function isDirectRun(): boolean {
  return Boolean(
    process.argv[1] &&
      import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href,
  );
}

if (isDirectRun()) {
  runMigrations();
  console.log("Migrations kørt.");
}
