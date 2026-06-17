import { defineConfig } from "vitest/config";

// Each package owns its Vitest config and runs via `pnpm -r run test`. This root config only
// aggregates them as projects so a single `vitest run --coverage` produces one merged report for
// octocov (coverage must live at the workspace root in projects mode).
export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "apps/*/src/icons/**",
        "packages/test-support/**",
      ],
    },
  },
});
