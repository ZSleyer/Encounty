/**
 * vitest.ncc.config.ts: Standalone runner for the NCC detection quality suite.
 *
 * The suite in src/engine/__tests__ shells out to ffmpeg and works on real
 * game captures, so it is excluded from the default vitest run (see
 * vite.config.ts). Run it explicitly with:
 *
 *   yarn test:ncc
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/engine/__tests__/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
