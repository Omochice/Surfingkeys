import type { LogLevel } from "@sk/log";
import { consoleSink, createLogger } from "@sk/log";

// To turn on all levels: chrome.storage.local.set({"logLevels": ["log", "warn", "error"]})
const isEnabled = (level: LogLevel): Promise<boolean> =>
  new Promise((resolve) => {
    chrome.storage.local.get(["logLevels"], (r) => {
      const rawLogLevels: unknown = r?.["logLevels"];
      const logLevels: string[] = Array.isArray(rawLogLevels) ? rawLogLevels : ["error"];
      resolve(logLevels.includes(level));
    });
  });

const LOG = createLogger({ sinks: [consoleSink], isEnabled });

export { LOG };
