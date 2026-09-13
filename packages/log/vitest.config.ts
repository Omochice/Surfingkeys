import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    sequence: { shuffle: { tests: true } },
  },
});
