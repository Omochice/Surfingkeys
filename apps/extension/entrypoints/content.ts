import { start } from "@sk/content/content";
import { defineContentScript } from "wxt/utils/define-content-script";

// content.css is injected via the manifest (added in wxt.config's
// build:manifestGenerated hook from the public/ copy), not bundled per-entry, so
// it stays a single shared stylesheet that the frontend iframe also references.
export default defineContentScript({
  matches: ["<all_urls>"],
  matchAboutBlank: true,
  runAt: "document_start",
  allFrames: true,
  cssInjectionMode: "manual",
  main() {
    if (import.meta.env.FIREFOX) {
      start();
    } else {
      start({});
    }

    // The module is reached only through this dynamic import, so a production build drops it
    // entirely.
    if (import.meta.env.DEV) {
      void import("@sk/adapter/devLogging").then(({ enableDevLogging }) => {
        enableDevLogging("content");
      });
    }
  },
});
