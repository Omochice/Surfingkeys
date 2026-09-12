/** Every severity a record can carry, each named after the console method that emits it. */
const LOG_LEVELS = ["log", "warn", "error"] as const;

/** Severity of a log record, matching the console method used to emit it. */
type LogLevel = (typeof LOG_LEVELS)[number];

/** Destination a log record is handed to once the level gate has let it through. */
type LogSink = (level: LogLevel, ...args: unknown[]) => void;

/** The call signature every logger built here exposes. */
type Logger = (level: LogLevel, ...args: unknown[]) => void;

/** The shape an argument must have to be treated as an error. */
type ErrorLike = { name: string; message: string; stack?: string };

/**
 * Whether a log argument carries an error.
 *
 * Duck-typed on purpose: `instanceof Error` is unusable here, because a record can carry an Error
 * built in another realm (a page's window reaching a content script, or a structured-clone round
 * trip), whose prototype chain does not lead to this realm's Error.
 *
 * @param value - One argument of a log record.
 * @returns Whether the value carries the name and message of an error.
 */
function isErrorLike(value: unknown): value is ErrorLike {
  return (
    typeof value === "object" &&
    value != null &&
    "message" in value &&
    typeof value.message === "string" &&
    "name" in value &&
    typeof value.name === "string"
  );
}

/** Sink writing each record to the console method named after its level. */
const consoleSink: LogSink = (level, ...args) => {
  console[level](...args);
};

/** Configuration of a logger: where records go, and which levels are currently enabled. */
type LoggerOptions = {
  /**
   * Destinations of every enabled record. Read on each call, not copied, so a caller owning a
   * mutable array can attach a sink after construction.
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
 * The returned function is fire-and-forget: an asynchronous gate is awaited internally and a
 * rejected gate drops the record instead of surfacing an unhandled rejection. A throwing sink is
 * not swallowed.
 *
 * @param options - Sinks to write to and the level gate to consult.
 * @returns A function emitting one record per call, taking the console-style argument list.
 */
function createLogger(options: LoggerOptions): Logger {
  return (level, ...args) => {
    Promise.try(() => options.isEnabled(level)).then(
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

/** A logger together with the registry of destinations it writes to. */
type HostLogger = {
  /** Emits one record per call. */
  log: Logger;
  /** Attaches a destination, returning a disposer that detaches it again. */
  addLogSink: (sink: LogSink) => () => void;
};

/**
 * Build the single logger an extension context shares, writing to the console by default.
 *
 * The sink list is owned here and mutated rather than passed at construction, so a destination that
 * only exists in some builds can join a logger every call site already imports.
 *
 * @param read - Returns the raw stored list of enabled levels; the storage API stays with the host.
 * @returns The logger and the function attaching further destinations to it.
 */
function createHostLogger(read: () => Promise<unknown>): HostLogger {
  const sinks: LogSink[] = [consoleSink];
  return {
    log: createLogger({ sinks, isEnabled: storedLevelGate(read) }),
    addLogSink: (sink) => {
      sinks.push(sink);
      return () => {
        const at = sinks.indexOf(sink);
        if (at !== -1) sinks.splice(at, 1);
      };
    },
  };
}

export {
  consoleSink,
  createHostLogger,
  createLogger,
  isErrorLike,
  LOG_LEVELS,
  LOG_LEVELS_KEY,
  storedLevelGate,
};
export type { ErrorLike, HostLogger, Logger, LoggerOptions, LogLevel, LogSink };
