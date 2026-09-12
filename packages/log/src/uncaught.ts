import type { Logger } from "./logger";

/**
 * The part of an event target this module needs. Declared structurally rather than as `Window` so
 * the same helper serves a page window, a service-worker global, and a bare EventTarget in tests.
 */
type UncaughtEventTarget = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

/** Options narrowing which uncaught errors are reported. */
type CaptureOptions = {
  /** Report only errors attributable to this URL prefix, e.g. `chrome-extension://<id>/`. */
  origin?: string;
};

/** Error.isError rather than instanceof: an error thrown in another realm still passes. */
function extractStack(value: unknown): string | undefined {
  return Error.isError(value) ? value.stack : undefined;
}

/** Reads the event's filename; Chrome leaves it empty for a script it refuses to attribute. */
function extractFilename(event: Event): string | undefined {
  const filename: unknown = "filename" in event ? event.filename : undefined;
  return typeof filename === "string" && filename !== "" ? filename : undefined;
}

/**
 * Report errors that escaped every handler through `log`.
 *
 * Both events are read by property rather than by narrowing on ErrorEvent / PromiseRejectionEvent:
 * an event crossing realms (a frame, or a worker global) fails an `instanceof` check that its
 * fields still satisfy.
 *
 * @param target - Global object to listen on, e.g. `window` or a worker's `self`.
 * @param log - Logger receiving one "error" record per uncaught error or rejection.
 * @param options - Narrows what is reported; see {@link CaptureOptions}.
 * @returns A disposer removing both listeners.
 */
function captureUncaught(
  target: UncaughtEventTarget,
  log: Logger,
  options: CaptureOptions = {},
): () => void {
  const { origin } = options;
  // A content script's isolated world receives the page's own error events too, so without an
  // origin every site's broken script would be reported as ours. An error that carries neither a
  // filename nor a stack cannot be told apart from a page's, so it is dropped rather than guessed.
  const matchesOrigin = (filename: string | undefined, stack: string | undefined): boolean => {
    if (origin == null) return true;
    if (filename != null) return filename.startsWith(origin);
    return stack?.includes(origin) ?? false;
  };

  const onError = (event: Event): void => {
    const error = "error" in event ? event.error : undefined;
    const message = "message" in event ? event.message : undefined;
    if (!matchesOrigin(extractFilename(event), extractStack(error))) return;
    log("error", "Uncaught error:", error ?? message);
  };
  const onRejection = (event: Event): void => {
    const reason = "reason" in event ? event.reason : undefined;
    if (!matchesOrigin(undefined, extractStack(reason))) return;
    log("error", "Unhandled rejection:", reason);
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

export { captureUncaught };
export type { CaptureOptions, UncaughtEventTarget };
