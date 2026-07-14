import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
    // Coverage of the deterministic engine + generation layer (roadmap #3.3).
    // Thresholds sit just below current (engine ~95%, generation lower because
    // the AI/DB orchestration in generate-program/adapt-week isn't unit-tested)
    // to lock in coverage and catch regressions without being brittle.
    coverage: {
      provider: "v8",
      include: ["lib/engine/**", "lib/generation/**"],
      exclude: ["**/*.test.ts"],
      reporter: ["text", "html"],
      thresholds: {
        statements: 70,
        branches: 85,
        functions: 80,
        lines: 70,
      },
    },
  },
});
