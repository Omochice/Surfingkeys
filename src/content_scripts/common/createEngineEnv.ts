import browser from "@sk/adapter/browser";
import { LOG } from "@sk/adapter/log";
import { isInUIFrame, reportIssue } from "@sk/adapter/platform-utils";
import type { EngineEnv } from "@sk/core/engineEnv";
import { tabOpenLink } from "@sk/messaging/messagingActions";
import { RUNTIME } from "@sk/messaging/runtime";

/**
 * Build the concrete {@link EngineEnv} from the WebExtension seams. This is the one wiring point
 * that imports the chrome-touching modules; the composition roots call it and hand the result to
 * the engine. surfingkeys is exposed as a getter so it stays read lazily (the companion API may be
 * injected after startup).
 */
function createEngineEnv(): EngineEnv {
  return {
    RUNTIME,
    isInUIFrame,
    reportIssue,
    tabOpenLink,
    getExtensionURL: (path) => browser.runtime.getURL(path),
    log: LOG,
    get surfingkeys() {
      return chrome.surfingkeys;
    },
  };
}

export { createEngineEnv };
