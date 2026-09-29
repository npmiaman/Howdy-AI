import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Business-hours math uses local time; pin it so results don't depend on
    // the machine running the suite.
    env: { TZ: "UTC" },
    restoreMocks: true,
  },
});
