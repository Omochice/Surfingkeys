/** Severity of a log record, matching the console method used to emit it. */
type LogLevel = "log" | "warn" | "error";

/** Destination a log record is handed to once the level gate has let it through. */
type LogSink = (level: LogLevel, msg: unknown) => void;

/** Sink writing each record to the console method named after its level. */
const consoleSink: LogSink = (level, msg) => {
  console[level](msg);
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
 * @returns A function emitting one record per call.
 */
function createLogger(options: LoggerOptions): (level: LogLevel, msg: unknown) => void {
  return (level, msg) => {
    // The executor form runs isEnabled synchronously, so a gate reading external state starts
    // that read at call time, and a synchronous throw becomes a rejection instead of escaping.
    new Promise<boolean>((resolve) => {
      resolve(options.isEnabled(level));
    }).then(
      (enabled) => {
        if (!enabled) return;
        for (const sink of options.sinks) {
          sink(level, msg);
        }
      },
      () => {},
    );
  };
}

export { consoleSink, createLogger };
export type { LoggerOptions, LogLevel, LogSink };
