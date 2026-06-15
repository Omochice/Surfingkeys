import type { EngineEnv } from "@sk/core/engineEnv";

import browser from "./browser";
import { LOG } from "./log";
import { tabOpenLink } from "./messagingActions";
import { isInUIFrame, reportIssue } from "./platform-utils";
import { RUNTIME } from "./runtime";

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
