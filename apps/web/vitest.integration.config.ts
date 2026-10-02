import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Integration tests against a real Postgres with every migration applied
 * (DATABASE_URL), e.g. invoicing and payments end to end. Same database
 * set-up as packages/db's tenant-isolation tests.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "src/test/server-only.ts") } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
