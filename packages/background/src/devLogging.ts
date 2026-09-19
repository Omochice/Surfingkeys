import { LOG_LEVELS } from "@sk/log";
import { otlpSink } from "@sk/log/otlp";
import { DEV_LOG_ACTION } from "@sk/log/relay";
import type { UncaughtEventTarget } from "@sk/log/uncaught";
import { captureUncaught } from "@sk/log/uncaught";
import * as v from "valibot";

import { addLogSink, LOG, setDefaultLevels } from "./log";

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
  /** Emit a log record relayed by another extension context, ignoring anything else. */
  handleRelayedLog: (message: unknown) => void;
  /**
   * Start reporting the background's own records and uncaught errors to the collector with every
   * level enabled unless the stored level list says otherwise, returning a disposer.
   */
  enableDevLogging: (target: UncaughtEventTarget) => () => void;
};

/** Bind development logging to the OTLP/HTTP collector at the given base URL. */
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
      // This module is reached only from a development build, so its presence is what decides that
      // the quiet production default does not apply; no package can read the build mode itself.
      const restoreLevels = setDefaultLevels(LOG_LEVELS);
      const sink = otlpSink({ url, resourceAttributes: { "sk.context": "background" } });
      const removeSink = addLogSink(sink);
      const stopCapture = captureUncaught(target, LOG);
      return () => {
        removeSink();
        stopCapture();
        restoreLevels();
      };
    },
  };
}

export { createDevLogging };
export type { DevLogging };
