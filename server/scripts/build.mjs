// Bygger serveren til ét selvstændigt ESM-bundle.
//
// Hvorfor bundle frem for tsc-output: serveren er en del af et npm-workspace og
// afhænger af @spil/shared. Et almindeligt tsc-build ville kræve at hele
// workspacet — og dets node_modules — fulgte med i releasen. Med et bundle
// følger kun better-sqlite3 med, fordi det er et native modul der ikke kan
// bundles.
//
// Kør: node scripts/build.mjs
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/index.ts")],
  outfile: path.join(outDir, "index.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // Native modul — kan ikke bundles og installeres i stedet ved siden af.
  external: ["better-sqlite3"],
  banner: {
    // Nogle afhængigheder når efter require i CommonJS-stil. Uden den her shim
    // fejler de først ved kørsel, ikke ved bygning.
    js: "import { createRequire as _cr } from 'node:module';const require = _cr(import.meta.url);",
  },
  logLevel: "info",
});

// Migrationerne læses fra disken ved opstart og skal ligge ved siden af bundlet.
// migrate.ts slår dem op relativt til import.meta.url, som efter bundling er
// dist/index.js — altså dist/migrations.
cpSync(path.join(root, "src/db/migrations"), path.join(outDir, "migrations"), {
  recursive: true,
});

console.log("Server bygget til dist/");
