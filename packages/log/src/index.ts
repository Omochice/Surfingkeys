/** Severity of a log record, matching the console method used to emit it. */
type LogLevel = "log" | "warn" | "error";

/** Destination a log record is handed to once the level gate has let it through. */
type LogSink = (level: LogLevel, ...args: unknown[]) => void;

/** Sink writing each record to the console method named after its level. */
const consoleSink: LogSink = (level, ...args) => {
  console[level](...args);
};

/** Configuration of a logger: where records go, and which levels are currently enabled. */
type LoggerOptions = {
  sinks: readonly LogSink[];
  /**
   * Decides whether a level is enabled. Consulted on every call rather than once at construction,
   * so a setting changed at runtime takes effect on the next record.
   */
  isEnabled: (level: LogLevel) => boolean | Promise<boolean>;
};

/**
 * Build a logging function forwarding enabled records to every sink.
 *
 * The returned function is fire-and-forget: an asynchronous gate is awaited internally and a
 * rejected gate drops the record instead of surfacing an unhandled rejection. A throwing sink is
 * not swallowed.
 *
 * @param options - Sinks to write to and the level gate to consult.
 * @returns A function emitting one record per call, taking the console-style argument list.
 */
function createLogger(options: LoggerOptions): (level: LogLevel, ...args: unknown[]) => void {
  return (level, ...args) => {
    // The executor form runs isEnabled synchronously, so a gate reading external state starts
    // that read at call time, and a synchronous throw becomes a rejection instead of escaping.
    new Promise<boolean>((resolve) => {
      resolve(options.isEnabled(level));
    }).then(
      (enabled) => {
        if (!enabled) return;
        for (const sink of options.sinks) {
          sink(level, ...args);
        }
      },
      () => {},
    );
  };
}

/** Storage key holding the list of enabled levels. */
const LOG_LEVELS_KEY = "logLevels";

/** Levels enabled when nothing usable is stored: errors are never silenced by a missing setting. */
const DEFAULT_LEVELS: readonly LogLevel[] = ["error"];

/**
 * Build a level gate deciding from a stored list of level names.
 *
 * A stored value that is not an array (absent, or written by hand as a string) is treated as unset
 * and falls back to errors only.
 *
 * @param read - Returns the raw stored value, leaving the storage API to the caller.
 * @returns A gate answering whether the given level is currently enabled.
 */
function storedLevelGate(read: () => Promise<unknown>): (level: LogLevel) => Promise<boolean> {
  return async (level) => {
    const raw = await read();
    const levels: readonly unknown[] = Array.isArray(raw) ? raw : DEFAULT_LEVELS;
    return levels.includes(level);
  };
}

export { consoleSink, createLogger, LOG_LEVELS_KEY, storedLevelGate };
export type { LoggerOptions, LogLevel, LogSink };
