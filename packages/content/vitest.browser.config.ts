import solid from "@solidjs/vite-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Browser-mode project for *.browser.test.ts. jsdom implements neither Element.setHTML nor the
// Sanitizer API behind it, and the unit suite's DOMPurify shim has a different attribute policy
// from the real sanitizer, so these tests run in actual Chromium/Firefox.
export default defineConfig({
  plugins: [solid()],
  test: {
    // Distinct from the jsdom project (which inherits the package name) so both can run together
    // under the root coverage run.
    name: "content-browser",
    sequence: { shuffle: { tests: true } },
    include: ["src/**/*.browser.test.{ts,tsx}"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }, { browser: "firefox" }],
    },
  },
});
