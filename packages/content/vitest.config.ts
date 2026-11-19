import solid from "@solidjs/vite-plugin";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "jsdom",
    setupFiles: ["@sk/test-support/setup"],
    // *.browser.test.ts runs in real browsers via vitest.browser.config.ts; keep it out of the
    // jsdom run, whose DOMPurify setHTML shim would mask what those tests verify.
    exclude: [...configDefaults.exclude, "**/*.browser.test.{ts,tsx}"],
    sequence: { shuffle: { tests: true } },
  },
});
