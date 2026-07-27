import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // fake-indexeddb giver Dexie et rigtigt IndexedDB at køre mod, så testen
    // rammer den samme kode som browseren gør.
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
