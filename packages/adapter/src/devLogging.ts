import type { LogSink } from "@sk/log";
import type { RelayedLogRecord } from "@sk/log/relay";
import { DEV_LOG_ACTION, toTransferable } from "@sk/log/relay";
import { captureUncaught } from "@sk/log/uncaught";

import { addLogSink, LOG } from "./log";

/** Sink forwarding a record to the background, which owns the collector connection. */
function relaySink(context: string): LogSink {
  return (level, ...args) => {
    const record: RelayedLogRecord = {
      action: DEV_LOG_ACTION,
      context,
      level,
      args: args.map(toTransferable),
    };
    // chrome.runtime is used raw rather than through @sk/messaging's RUNTIME: RUNTIME reports a
    // failed send through reportError, which logs, which would re-enter this sink in a loop.
    try {
      chrome.runtime.sendMessage(record, () => {
        // Reading lastError silences Chrome's "unchecked runtime.lastError" warning when the
        // background is asleep or the extension context is gone.
        void chrome.runtime.lastError;
      });
    } catch {
      // An invalidated extension context throws here; a log relay must not make that worse.
    }
  };
}

/**
 * Start relaying this context's log records and uncaught errors to the background.
 *
 * Content scripts cannot reach the collector themselves: their fetches carry the page's origin and
 * are refused by CORS and the private-network checks a localhost endpoint triggers. The background
 * is the one context with an unrestricted fetch, so it owns the single exit point.
 *
 * @param context - Value reported as `sk.context`, e.g. "content" or "frontend".
 * @returns A disposer detaching the relay sink and the uncaught-error listeners.
 */
function enableDevLogging(context: string): () => void {
  const removeSink = addLogSink(relaySink(context));
  // The isolated world receives the page's error events too, so only errors attributable to a
  // script served from the extension itself are reported.
  const stopCapture = captureUncaught(window, LOG, { origin: chrome.runtime.getURL("") });
  return () => {
    removeSink();
    stopCapture();
  };
}

export { enableDevLogging };
