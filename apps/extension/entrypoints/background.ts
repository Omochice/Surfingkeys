import { chromeSpecifics } from "@sk/background/chrome";
import { firefoxSpecifics } from "@sk/background/firefox";
import type { MessageHandler } from "@sk/background/start";
import { start } from "@sk/background/start";
import { DEV_LOG_ACTION } from "@sk/log/relay";
import { defineBackground } from "wxt/utils/define-background";

// Listeners must register synchronously on service-worker startup (MV3), so the
// browser specifics are static imports and start() runs in the entry body.
export default defineBackground(() => {
  // The module is reached only through this dynamic import, so a production build drops it
  // entirely.
  const extraHandlers: Record<string, MessageHandler> = {};
  if (import.meta.env.DEV) {
    const dev = import("@sk/background/devLogging");
    // Registered before the module resolves: a message that wakes a sleeping service worker is
    // dropped unless a listener is already in place.
    extraHandlers[DEV_LOG_ACTION] = (message: unknown) => {
      void dev.then(({ handleRelayedLog }) => handleRelayedLog(message));
      return undefined;
    };
    void dev.then(({ enableDevLogging }) => enableDevLogging(self));
  }

  start(import.meta.env.FIREFOX ? firefoxSpecifics : chromeSpecifics, extraHandlers);
});
