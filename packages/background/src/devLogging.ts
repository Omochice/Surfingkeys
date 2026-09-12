import { LOG_LEVELS } from "@sk/log";
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
  level: v.picklist(LOG_LEVELS),
  args: v.array(v.unknown()),
});

/**
 * Emit a log record relayed by another extension context.
 *
 * A message that is not a relayed record is ignored.
 *
 * @param message - Raw runtime message, of any shape.
 */
function handleRelayedLog(message: unknown): void {
  const parsed = v.safeParse(relayedLogSchema, message);
  if (!parsed.success) return;
  const record = parsed.output;
  // The sink is built per record rather than cached per context: `context` comes from a sender any
  // page's content script can impersonate, so a map keyed on it would grow without bound.
  const sink = otlpSink({ url: OTLP_URL, resourceAttributes: { "sk.context": record.context } });
  sink(record.level, ...record.args);
}

/**
 * Start reporting the background's own records and uncaught errors to the collector.
 *
 * @param target - Worker global to listen on for uncaught errors, i.e. `self`.
 * @returns A disposer detaching the OTLP sink and the uncaught-error listeners.
 */
function enableDevLogging(target: UncaughtEventTarget): () => void {
  const sink = otlpSink({ url: OTLP_URL, resourceAttributes: { "sk.context": "background" } });
  const removeSink = addLogSink(sink);
  const stopCapture = captureUncaught(target, LOG);
  return () => {
    removeSink();
    stopCapture();
  };
}

export { enableDevLogging, handleRelayedLog };
