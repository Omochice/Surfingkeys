import { LOG } from "@sk/adapter/log";
import { isInUIFrame, reportIssue } from "@sk/adapter/platform-utils";
import type { EngineEnv, SurfingkeysHost } from "@sk/core/engineEnv";
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
    getExtensionURL: (path) => chrome.runtime.getURL(path),
    log: LOG,
    get surfingkeys() {
      // chrome.surfingkeys is a non-standard companion API not in @types/chrome; read it through a
      // local cast to the engine-owned SurfingkeysHost type instead of an ambient chrome.d.ts, so
      // no `declare namespace chrome` augmentation has to be kept out of @sk/core's boundary.
      return (chrome as unknown as { surfingkeys?: SurfingkeysHost }).surfingkeys;
    },
  };
}

export { createEngineEnv };
