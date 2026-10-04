import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // PGlite boots a WASM Postgres per file; keep files isolated.
    pool: "forks",
    globalSetup: ["test/helpers/globalSetup.ts"],
    setupFiles: ["test/helpers/setup.ts"],
  },
});
