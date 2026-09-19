import { createHostLogger, LOG_LEVELS_KEY } from "@sk/log";

// A stored list wins over whichever levels are enabled by default, in either build:
// chrome.storage.local.set({"logLevels": ["log", "warn", "error"]})
const readLogLevels = (): Promise<unknown> =>
  chrome.storage.local.get([LOG_LEVELS_KEY]).then((r) => r[LOG_LEVELS_KEY]);

/** Content-side logger, its sink registry and its default-level control. */
const { log: LOG, addLogSink, setDefaultLevels } = createHostLogger(readLogLevels);

export { addLogSink, LOG, setDefaultLevels };
