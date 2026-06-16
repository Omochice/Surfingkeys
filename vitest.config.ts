import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  // Solid ships separate dev/prod builds; Vitest must pick the dev build for
  // reactivity and a single solid-js instance.
  resolve: {
    conditions: ["development", "browser"],
  },
  test: {
    environment: "jsdom",
    include: ["packages/*/src/**/*.test.{ts,tsx,js}", "apps/*/src/**/*.test.{ts,tsx,js}"],
    setupFiles: ["test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts", "apps/*/src/icons/**"],
    },
  },
});
