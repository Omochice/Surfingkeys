import { createHostLogger, LOG_LEVELS_KEY } from "@sk/log";

// The storage read is duplicated from @sk/adapter rather than imported: the adapter is the
// content-script seam and depends on @sk/core, which the background must not pull in.
// To turn on all levels: chrome.storage.local.set({"logLevels": ["log", "warn", "error"]})
const readLogLevels = (): Promise<unknown> =>
  chrome.storage.local.get([LOG_LEVELS_KEY]).then((r) => r?.[LOG_LEVELS_KEY]);

/**
 * Background-side logger and its sink registry.
 *
 * {@link LOG} writes to the console for the levels enabled in local storage; {@link addLogSink}
 * attaches a further destination and returns a disposer detaching it.
 */
const { log: LOG, addLogSink } = createHostLogger(readLogLevels);

export { addLogSink, LOG };
