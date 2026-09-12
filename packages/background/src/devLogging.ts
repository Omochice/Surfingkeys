import { LOG_LEVELS } from "@sk/log";
import { otlpSink } from "@sk/log/otlp";
import { DEV_LOG_ACTION } from "@sk/log/relay";
import type { UncaughtEventTarget } from "@sk/log/uncaught";
import { captureUncaught } from "@sk/log/uncaught";
import * as v from "valibot";

import { addLogSink, LOG } from "./log";

// The relayed envelope crosses the extension messaging boundary, so its shape is validated rather
// than trusted; a content script of any page can send anything under this action.
const relayedLogSchema = v.object({
  action: v.literal(DEV_LOG_ACTION),
  context: v.string(),
  level: v.picklist(LOG_LEVELS),
  args: v.array(v.unknown()),
});

/** The two entry points of development logging, bound to one collector. */
type DevLogging = {
  /**
   * Emit a log record relayed by another extension context. A message that is not a relayed record
   * is ignored.
   */
  handleRelayedLog: (message: unknown) => void;
  /**
   * Start reporting the background's own records and uncaught errors to the collector, listening
   * for the latter on `target`. Returns a disposer detaching both.
   */
  enableDevLogging: (target: UncaughtEventTarget) => () => void;
};

/**
 * Bind development logging to an OTLP/HTTP collector.
 *
 * @param url - Collector base URL; the caller decides where records go.
 * @returns The relay handler and the switch for the background's own records.
 */
function createDevLogging(url: string): DevLogging {
  return {
    handleRelayedLog: (message) => {
      const parsed = v.safeParse(relayedLogSchema, message);
      if (!parsed.success) return;
      const record = parsed.output;
      // Built per record rather than cached per context: `context` comes from a sender any page's
      // content script can impersonate, so a map keyed on it would grow without bound.
      const sink = otlpSink({ url, resourceAttributes: { "sk.context": record.context } });
      sink(record.level, ...record.args);
    },
    enableDevLogging: (target) => {
      const sink = otlpSink({ url, resourceAttributes: { "sk.context": "background" } });
      const removeSink = addLogSink(sink);
      const stopCapture = captureUncaught(target, LOG);
      return () => {
        removeSink();
        stopCapture();
      };
    },
  };
}

export { createDevLogging };
export type { DevLogging };
