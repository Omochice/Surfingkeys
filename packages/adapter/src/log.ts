import type { LogSink } from "@sk/log";
import { consoleSink, createLogger, LOG_LEVELS_KEY, storedLevelGate } from "@sk/log";

// To turn on all levels: chrome.storage.local.set({"logLevels": ["log", "warn", "error"]})
const readLogLevels = (): Promise<unknown> =>
  new Promise((resolve) => {
    chrome.storage.local.get([LOG_LEVELS_KEY], (r) => {
      resolve(r?.[LOG_LEVELS_KEY]);
    });
  });

const sinks: LogSink[] = [consoleSink];

/** Content-side logger: writes to the console for the levels enabled in local storage. */
const LOG = createLogger({ sinks, isEnabled: storedLevelGate(readLogLevels) });

/**
 * Attach an extra destination to {@link LOG}.
 *
 * The list is mutated rather than passed at construction so the development-only relay sink can
 * join a logger every call site already imports.
 *
 * @param sink - Destination receiving every enabled record from now on.
 * @returns A disposer detaching the sink again.
 */
function addLogSink(sink: LogSink): () => void {
  sinks.push(sink);
  return () => {
    const at = sinks.indexOf(sink);
    if (at !== -1) sinks.splice(at, 1);
  };
}

export { addLogSink, LOG };
