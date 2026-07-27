import { rmSync } from "node:fs";
import path from "node:path";

/**
 * Rydder databasen og uploads før hver kørsel.
 *
 * Uden det ser anden kørsel en installation der allerede er sat op, og testen
 * ville kun bestå på et rent checkout — den slags gør en test upålidelig
 * præcis når man har mest brug for den.
 */
export default function globalSetup(): void {
  rmSync(path.join(process.cwd(), ".playwright-tmp"), { recursive: true, force: true });
}
