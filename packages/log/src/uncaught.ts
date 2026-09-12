import type { LogLevel } from "./index";

/**
 * The part of an event target this module needs. Declared structurally rather than as `Window` so
 * the same helper serves a page window, a service-worker global, and a bare EventTarget in tests.
 */
type UncaughtEventTarget = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

/** The logger call signature, repeated here to keep this module independent of a logger instance. */
type LogFn = (level: LogLevel, ...args: unknown[]) => void;

/**
 * Report errors that escaped every handler through `log`.
 *
 * Both events are read by property rather than by narrowing on ErrorEvent / PromiseRejectionEvent:
 * an event crossing realms (a frame, or a worker global) fails an `instanceof` check that its
 * fields still satisfy.
 *
 * @param target - Global object to listen on, e.g. `window` or a worker's `self`.
 * @param log - Logger receiving one "error" record per uncaught error or rejection.
 * @returns A disposer removing both listeners.
 */
function captureUncaught(target: UncaughtEventTarget, log: LogFn): () => void {
  const onError = (event: Event): void => {
    const error = "error" in event ? event.error : undefined;
    const message = "message" in event ? event.message : undefined;
    log("error", "Uncaught error:", error ?? message);
  };
  const onRejection = (event: Event): void => {
    log("error", "Unhandled rejection:", "reason" in event ? event.reason : undefined);
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

export { captureUncaught };
export type { LogFn, UncaughtEventTarget };
