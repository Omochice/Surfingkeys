import solid from "vite-plugin-solid";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  // Solid ships separate dev/prod builds; Vitest must pick the dev build for
  // reactivity and a single solid-js instance.
  resolve: {
    conditions: ["development", "browser"],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["@sk/test-support/setup"],
    // *.browser.test.ts runs in real browsers via vitest.browser.config.ts; keep it out of the
    // jsdom run, whose DOMPurify setHTML shim would mask what those tests verify.
    exclude: [...configDefaults.exclude, "**/*.browser.test.{ts,tsx}"],
  },
});
