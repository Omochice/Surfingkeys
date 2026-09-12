import type { LogSink } from "@sk/log";
import { otlpSink } from "@sk/log/otlp";
import { DEV_LOG_ACTION } from "@sk/log/relay";
import type { UncaughtEventTarget } from "@sk/log/uncaught";
import { captureUncaught } from "@sk/log/uncaught";
import * as v from "valibot";

import { addLogSink, LOG } from "./log";

/** Default OTLP/HTTP endpoint of a locally running collector. */
const OTLP_URL = "http://localhost:4318";

// The relayed envelope crosses the extension messaging boundary, so its shape is validated rather
// than trusted; a content script of any page can send anything under this action.
const relayedLogSchema = v.object({
  action: v.literal(DEV_LOG_ACTION),
  context: v.string(),
  level: v.picklist(["log", "warn", "error"]),
  args: v.array(v.unknown()),
});

// One sink per context: the resource attributes are fixed at construction, and the contexts are a
// closed handful ("content", "frontend"), so the sinks are kept rather than rebuilt per record.
const sinksByContext = new Map<string, LogSink>();

function sinkFor(context: string): LogSink {
  const existing = sinksByContext.get(context);
  if (existing) return existing;
  const sink = otlpSink({ url: OTLP_URL, resourceAttributes: { "sk.context": context } });
  sinksByContext.set(context, sink);
  return sink;
}

/**
 * Emit a log record relayed by another extension context.
 *
 * @param message - Raw runtime message, of any shape.
 * @returns Whether the message was a relayed record and has been emitted.
 */
function handleRelayedLog(message: unknown): boolean {
  const parsed = v.safeParse(relayedLogSchema, message);
  if (!parsed.success) return false;
  const record = parsed.output;
  sinkFor(record.context)(record.level, ...record.args);
  return true;
}

/**
 * Start reporting the background's own records and uncaught errors to the collector.
 *
 * @param target - Worker global to listen on for uncaught errors, i.e. `self`.
 * @returns A disposer detaching the OTLP sink and the uncaught-error listeners.
 */
function enableDevLogging(target: UncaughtEventTarget): () => void {
  const removeSink = addLogSink(sinkFor("background"));
  const stopCapture = captureUncaught(target, LOG);
  return () => {
    removeSink();
    stopCapture();
  };
}

export { enableDevLogging, handleRelayedLog, OTLP_URL };
