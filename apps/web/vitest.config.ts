import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "src/test/server-only.ts") } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Playwright specs live in tests/e2e and run with `pnpm test:e2e`, not Vitest.
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
  },
});
