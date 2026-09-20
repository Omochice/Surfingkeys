import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["@sk/test-support/setup"],
    sequence: { shuffle: { tests: true } },
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.snippet.json",
      include: ["src/**/*.test-d.ts"],
    },
  },
});
