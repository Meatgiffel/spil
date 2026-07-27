import path from "node:path";
import { defineConfig } from "@playwright/test";

// Tests mod den byggede app, ikke dev-serveren: service worker'en findes kun i
// en produktionsbygning, og det er præcis offline-adfærden vi tester.
const scratch = path.join(process.cwd(), ".playwright-tmp");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    // Telefonstørrelse — appen er mobile-first, så det er den rigtige måde at
    // teste den på. isMobile sættes ikke: chromium-headless-shell er det eneste
    // der er installeret på maskinen, og den understøtter det ikke.
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "npx tsx src/index.ts",
      cwd: path.join(process.cwd(), "..", "server"),
      port: 5060,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "development",
        PORT: "5060",
        DATABASE_PATH: path.join(scratch, "e2e.db"),
        UPLOADS_DIR: path.join(scratch, "uploads"),
        BETTER_AUTH_SECRET: "e2e-hemmelighed-der-er-lang-nok-1234567890",
        PUBLIC_URL: "http://127.0.0.1:4173",
        TRUSTED_ORIGINS: "http://127.0.0.1:4173",
      },
    },
    {
      // --host 127.0.0.1: uden den binder vite preview kun til ::1, og så kan
      // browseren ikke nå den på 127.0.0.1.
      command: "npx vite preview --port 4173 --strictPort --host 127.0.0.1",
      port: 4173,
      reuseExistingServer: false,
    },
  ],
});
