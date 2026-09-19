/** Every severity a record can carry, each named after the console method that emits it. */
const LOG_LEVELS = ["log", "warn", "error"] as const;

/** Severity of a log record, matching the console method used to emit it. */
type LogLevel = (typeof LOG_LEVELS)[number];

/** Destination a log record is handed to once the level gate has let it through. */
type LogSink = (level: LogLevel, ...args: unknown[]) => void;

/** The call signature every logger built here exposes. */
type Logger = (level: LogLevel, ...args: unknown[]) => void;

/** Sink writing each record to the console method named after its level. */
const consoleSink: LogSink = (level, ...args) => {
  console[level](...args);
};

/** Configuration of a logger: where records go, and which levels are currently enabled. */
type LoggerOptions = {
  /**
   * Destinations of every enabled record. Read on each call rather than copied, so a mutation of
   * the list takes effect on the next record.
   */
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
 * A rejected gate drops the record and a throwing sink is skipped, so nothing surfaces as an
 * unhandled rejection that the uncaught-error capture would feed back into this logger.
 */
function createLogger(options: LoggerOptions): Logger {
  return (level, ...args) => {
    Promise.try(() => options.isEnabled(level)).then(
      (enabled) => {
        if (!enabled) return;
        for (const sink of options.sinks) {
          // Promise.try rather than try/catch: a sink typed as returning void may still be an async
          // function, and its rejection has no one to report to but this logger.
          void Promise.try(() => sink(level, ...args)).catch(() => {});
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
 * Build a level gate deciding from a stored list of level names, treating a stored value that is
 * not an array as unset and falling back to the levels `readFallback` reports.
 *
 * The fallback is a getter rather than a value so a host that lowers it later is honoured on the
 * next record instead of only by gates built afterwards.
 */
function storedLevelGate(
  read: () => Promise<unknown>,
  readFallback: () => readonly LogLevel[] = () => DEFAULT_LEVELS,
): (level: LogLevel) => Promise<boolean> {
  return async (level) => {
    const raw = await read();
    const levels: readonly unknown[] = Array.isArray(raw) ? raw : readFallback();
    return levels.includes(level);
  };
}

/** A logger together with the registry of destinations it writes to. */
type HostLogger = {
  /** Emits one record per call. */
  log: Logger;
  /** Attaches a destination, returning a disposer that detaches it again. */
  addLogSink: (sink: LogSink) => () => void;
  /**
   * Replaces the levels enabled while nothing is stored, returning a disposer that puts the
   * previous ones back. A stored list still wins over them.
   */
  setDefaultLevels: (levels: readonly LogLevel[]) => () => void;
};

/**
 * Build a console-writing logger together with the registry of its sinks.
 *
 * The sink list and the fallback levels are owned here and mutated rather than passed at
 * construction, so both can be changed after the logger has been handed out.
 */
function createHostLogger(read: () => Promise<unknown>): HostLogger {
  const sinks: LogSink[] = [consoleSink];
  let defaultLevels = DEFAULT_LEVELS;
  return {
    log: createLogger({ sinks, isEnabled: storedLevelGate(read, () => defaultLevels) }),
    setDefaultLevels: (levels) => {
      const previous = defaultLevels;
      defaultLevels = levels;
      return () => {
        defaultLevels = previous;
      };
    },
    addLogSink: (sink) => {
      sinks.push(sink);
      return () => {
        const at = sinks.indexOf(sink);
        if (at !== -1) sinks.splice(at, 1);
      };
    },
  };
}

export { consoleSink, createHostLogger, createLogger, LOG_LEVELS, LOG_LEVELS_KEY, storedLevelGate };
export type { HostLogger, Logger, LoggerOptions, LogLevel, LogSink };
