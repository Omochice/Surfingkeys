import { consoleSink, createLogger, LOG_LEVELS_KEY, storedLevelGate } from "@sk/log";

// The storage wiring is duplicated from @sk/adapter rather than imported: the adapter is the
// content-script seam and depends on @sk/core, which the background must not pull in.
// To turn on all levels: chrome.storage.local.set({"logLevels": ["log", "warn", "error"]})
const readLogLevels = (): Promise<unknown> =>
  new Promise((resolve) => {
    chrome.storage.local.get([LOG_LEVELS_KEY], (r) => {
      resolve(r?.[LOG_LEVELS_KEY]);
    });
  });

/** Background-side logger: writes to the console for the levels enabled in local storage. */
const LOG = createLogger({ sinks: [consoleSink], isEnabled: storedLevelGate(readLogLevels) });

export { LOG };
