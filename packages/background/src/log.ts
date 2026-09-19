import { createHostLogger, LOG_LEVELS_KEY } from "@sk/log";

// The storage read is duplicated from @sk/adapter rather than imported: the adapter is the
// content-script seam and depends on @sk/core, which the background must not pull in.
// A stored list wins over whichever levels are enabled by default, in either build:
// chrome.storage.local.set({"logLevels": ["log", "warn", "error"]})
const readLogLevels = (): Promise<unknown> =>
  chrome.storage.local.get([LOG_LEVELS_KEY]).then((r) => r[LOG_LEVELS_KEY]);

/** Background-side logger, its sink registry and its default-level control. */
const { log: LOG, addLogSink, setDefaultLevels } = createHostLogger(readLogLevels);

export { addLogSink, LOG, setDefaultLevels };
