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
    include: ["src/**/*.test.{ts,tsx,js}", "packages/*/src/**/*.test.{ts,tsx,js}"],
    setupFiles: ["test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/icons/**"],
    },
  },
});
