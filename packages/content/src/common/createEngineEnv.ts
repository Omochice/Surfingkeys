import { LOG } from "@sk/adapter/log";
import { isInUIFrame, reportIssue } from "@sk/adapter/platform-utils";
import type { EngineEnv, SurfingkeysHost } from "@sk/core/engineEnv";
import { tabOpenLink } from "@sk/messaging/messagingActions";
import { notify, request } from "@sk/messaging/runtime";

/**
 * Build the concrete {@link EngineEnv} from the WebExtension seams. surfingkeys is a getter so it is
 * read lazily: the companion API may be injected after startup.
 */
function createEngineEnv(): EngineEnv {
  return {
    notify,
    request,
    isInUIFrame,
    reportIssue,
    tabOpenLink,
    getExtensionURL: (path) => chrome.runtime.getURL(path),
    log: LOG,
    get surfingkeys() {
      // chrome.surfingkeys is a non-standard companion API not in @types/chrome; a local cast
      // avoids a `declare namespace chrome` augmentation leaking into @sk/core's boundary.
      return (chrome as unknown as { surfingkeys?: SurfingkeysHost }).surfingkeys;
    },
  };
}

export { createEngineEnv };
