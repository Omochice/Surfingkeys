import type { LogLevel, LogSink } from "./logger";
import { isErrorLike } from "./logger";

/** Configuration of an OTLP sink: the collector to reach and what identifies this process. */
type OtlpSinkOptions = {
  /** Collector base URL, without the signal path; "/v1/logs" is appended. */
  url: string;
  /** Extra resource attributes, e.g. `{ "sk.context": "background" }`. */
  resourceAttributes?: Record<string, string>;
};

/** An OTLP attribute value. Only the string form is produced here. */
type OtlpAttribute = { key: string; value: { stringValue: string } };

/** Severity number and text OTLP expects, keyed by the console-shaped level. */
const SEVERITY: Record<LogLevel, { number: number; text: string }> = {
  log: { number: 9, text: "INFO" },
  warn: { number: 13, text: "WARN" },
  error: { number: 17, text: "ERROR" },
};

/** Attribute naming this codebase as the emitting service, per OTLP semantic conventions. */
const SERVICE_NAME = "surfingkeys";

/** Record attribute repeated from the resource so one record identifies its extension context. */
const CONTEXT_KEY = "sk.context";

/** Renders one argument the way the console would display it. */
function renderArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (isErrorLike(arg)) return arg.message;
  if (typeof arg === "object" && arg != null) {
    try {
      return JSON.stringify(arg) ?? String(arg);
    } catch {
      // Circular or otherwise unserialisable: the body is a human-readable summary, not data, so
      // degrading to the default string form is better than dropping the record.
      return String(arg);
    }
  }
  return String(arg);
}

/** Builds the string attribute list OTLP expects from a plain record. */
function toAttributes(entries: Record<string, string>): OtlpAttribute[] {
  return Object.entries(entries).map(([key, value]) => ({ key, value: { stringValue: value } }));
}

/**
 * Build a sink posting each record to an OTLP/HTTP collector as JSON.
 *
 * The payload is hand-built rather than produced by the OpenTelemetry SDK: the extension ships one
 * signal, in development builds only, and the SDK would add a dependency to every bundle.
 *
 * Delivery is fire-and-forget and every failure is swallowed, so a collector that is not running
 * costs nothing more than a failed request: the sink never throws and never leaves an unhandled
 * rejection behind.
 *
 * @param options - Collector URL and the resource attributes identifying this process.
 * @returns A sink usable in a logger's `sinks` list.
 */
function otlpSink(options: OtlpSinkOptions): LogSink {
  const resourceAttributes = options.resourceAttributes ?? {};
  const resource = {
    attributes: toAttributes({ "service.name": SERVICE_NAME, ...resourceAttributes }),
  };
  const endpoint = `${options.url}/v1/logs`;

  return (level, ...args) => {
    const severity = SEVERITY[level];
    const cause = args.find(isErrorLike);
    const recordAttributes: Record<string, string> = {};
    const context = resourceAttributes[CONTEXT_KEY];
    if (context != null) recordAttributes[CONTEXT_KEY] = context;
    if (cause != null) {
      recordAttributes["exception.type"] = cause.name;
      recordAttributes["exception.message"] = cause.message;
      recordAttributes["exception.stacktrace"] = cause.stack ?? "";
    }

    const payload = {
      resourceLogs: [
        {
          resource,
          scopeLogs: [
            {
              scope: { name: "@sk/log" },
              logRecords: [
                {
                  // OTLP wants nanoseconds as a string; millisecond precision is all a browser
                  // clock offers, so the sub-millisecond digits are zeroes.
                  timeUnixNano: `${Date.now()}000000`,
                  severityNumber: severity.number,
                  severityText: severity.text,
                  body: { stringValue: args.map(renderArg).join(" ") },
                  attributes: toAttributes(recordAttributes),
                },
              ],
            },
          ],
        },
      ],
    };

    // The request is dispatched synchronously so a context about to be torn down (an MV3 service
    // worker going idle) still gets it out. The try/catch covers a fetch that is missing or throws
    // on the spot, which `.catch` alone would let escape into the caller.
    try {
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {
      // A log sink reporting its own failure would be a loop; the record is dropped instead.
    }
  };
}

export { otlpSink };
export type { OtlpSinkOptions };
