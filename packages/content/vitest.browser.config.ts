import { playwright } from "@vitest/browser-playwright";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

// Browser-mode project for *.browser.test.ts. jsdom implements neither Element.setHTML nor the
// Sanitizer API behind it, and the unit suite only shims setHTML with DOMPurify — whose attribute
// policy differs from the real sanitizer. These tests run in actual Chromium/Firefox so code paths
// depending on the real browser API are verified against the implementation that ships.
export default defineConfig({
  plugins: [solid()],
  // Solid ships separate dev/prod builds; pick the dev build for a single solid-js instance.
  resolve: {
    conditions: ["development", "browser"],
  },
  test: {
    include: ["src/**/*.browser.test.{ts,tsx}"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }, { browser: "firefox" }],
    },
  },
});
