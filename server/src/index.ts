import { app } from "./app.js";
import { runMigrations } from "./db/migrate.js";
import { env } from "./env.js";

// Migrations køres ved opstart, så en release aldrig kan komme til at køre mod
// et ældre skema.
runMigrations();

// Deploy-scriptet kalder med SPIL_MIGRATE_ONLY=1 for at køre migrationerne mod
// den nye kode *før* servicen skifter til den. Fejler de, står den gamle
// version stadig og kører.
if (process.env.SPIL_MIGRATE_ONLY === "1") {
  console.log("Migrations kørt. Starter ikke serveren (SPIL_MIGRATE_ONLY=1).");
  process.exit(0);
}

app.listen(env.PORT, "127.0.0.1", () => {
  console.log(`Spil-API lytter på http://127.0.0.1:${env.PORT}`);
});
