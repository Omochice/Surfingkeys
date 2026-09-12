import { createHostLogger, LOG_LEVELS_KEY } from "@sk/log";

// To turn on all levels: chrome.storage.local.set({"logLevels": ["log", "warn", "error"]})
const readLogLevels = (): Promise<unknown> =>
  chrome.storage.local.get([LOG_LEVELS_KEY]).then((r) => r?.[LOG_LEVELS_KEY]);

/**
 * Content-side logger and its sink registry.
 *
 * {@link LOG} writes to the console for the levels enabled in local storage; {@link addLogSink}
 * attaches a further destination and returns a disposer detaching it.
 */
const { log: LOG, addLogSink } = createHostLogger(readLogLevels);

export { addLogSink, LOG };
