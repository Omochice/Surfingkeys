import { chromeSpecifics } from "@sk/background/chrome";
import { firefoxSpecifics } from "@sk/background/firefox";
import { start } from "@sk/background/start";
import { defineBackground } from "wxt/utils/define-background";

// Listeners must register synchronously on service-worker startup (MV3), so the
// browser specifics are static imports and start() runs in the entry body — no
// dynamic import.
export default defineBackground(() => {
  start(import.meta.env.FIREFOX ? firefoxSpecifics : chromeSpecifics);

  // Development builds ship their errors to a local OTLP collector. The module is reached only
  // through this dynamic import, so a production build drops it entirely.
  if (import.meta.env.DEV) {
    const dev = import("@sk/background/devLogging");
    // Registered in the entry body: a message that wakes a sleeping service worker is dropped unless
    // a listener exists by the end of the first turn. The awaited module only decides what it does.
    chrome.runtime.onMessage.addListener((message) => {
      void dev.then(({ handleRelayedLog }) => handleRelayedLog(message));
      return undefined;
    });
    void dev.then(({ enableDevLogging }) => enableDevLogging(self));
  }
});
