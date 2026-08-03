import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
    // Minimal dummy env so modules that import the strict env validator
    // (lib/env.ts, which throws on missing required vars outside the build phase)
    // load under Vitest. These are placeholders — no test makes real network calls.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      ANTHROPIC_API_KEY: "test-anthropic-key",
    },
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
