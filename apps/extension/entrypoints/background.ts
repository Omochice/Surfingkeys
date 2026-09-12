import { chromeSpecifics } from "@sk/background/chrome";
import { firefoxSpecifics } from "@sk/background/firefox";
import type { MessageHandler } from "@sk/background/start";
import { start } from "@sk/background/start";
import { DEV_LOG_ACTION } from "@sk/log/relay";
import { defineBackground } from "wxt/utils/define-background";

// Listeners must register synchronously on service-worker startup (MV3), so the
// browser specifics are static imports and start() runs in the entry body — no
// dynamic import.
export default defineBackground(() => {
  // Development builds ship their errors to a local OTLP collector. The module is reached only
  // through this dynamic import, so a production build drops it entirely.
  const extraHandlers: Record<string, MessageHandler> = {};
  if (import.meta.env.DEV) {
    const dev = import("@sk/background/devLogging");
    // Handed to start() in the entry body: a message that wakes a sleeping service worker is
    // dropped unless a listener exists by the end of the first turn. The awaited module only
    // decides what the handler does.
    extraHandlers[DEV_LOG_ACTION] = (message: unknown) => {
      void dev.then(({ handleRelayedLog }) => handleRelayedLog(message));
      return undefined;
    };
    void dev.then(({ enableDevLogging }) => enableDevLogging(self));
  }

  start(import.meta.env.FIREFOX ? firefoxSpecifics : chromeSpecifics, extraHandlers);
});
