import { Result } from "@praha/byethrow";
import { type ChromeRuntimeError, chromeRuntimeError } from "@sk/common/result";
import { conf, getCaseSensitive } from "@sk/core/conf";
import { repeatCount } from "@sk/core/repeatCount";
import { reportError } from "@sk/core/report";

// This module is the messaging service. Fire-and-forget sends keep the raw,
// callback-based chrome.runtime API rather than the promise-based
// BrowserAdapter: the polyfill's promise form would turn every callback-less
// call's "message port closed" into an unhandled rejection. request wraps that
// same send for callers that do handle a rejection. onMessage stays here too
// for the same callback contract.

type RuntimeFn = {
  <R = unknown>(
    action: string,
    args?: Record<string, unknown> | null,
    callback?: (response: R) => void,
  ): Result.Result<void, ChromeRuntimeError>;
};

const actionsRepeatBackground = [
  "closeTab",
  "nextTab",
  "previousTab",
  "moveTab",
  "reloadTab",
  "setZoom",
  "closeTabLeft",
  "closeTabRight",
  "focusTabByIndex",
];

function buildPayload(
  action: string,
  args: Record<string, unknown> | null | undefined,
  needResponse: boolean,
): Record<string, unknown> {
  const a: Record<string, unknown> = args || {};
  a["action"] = action;
  if (actionsRepeatBackground.includes(action)) {
    // if the action can only be repeated in background, pass repeats to background with args,
    // and set repeatCount.value 1, so that it won't be repeated in foreground's _handleMapKey
    a["repeats"] = repeatCount.value;
    repeatCount.value = 1;
  }
  a["needResponse"] = needResponse;
  return a;
}

/**
 * Call background `action` with `args`, the `callback` will be executed with response from
 * background. Returns a `Result` so callers decide whether to surface failure to the user.
 *
 * @example
 *   RUNTIME("getTabs", { queryInfo: { currentWindow: true } }, (response) => {
 *     console.log(response);
 *   });
 */
const RUNTIME: RuntimeFn = function <R = unknown>(
  action: string,
  args?: Record<string, unknown> | null,
  callback?: (response: R) => void,
): Result.Result<void, ChromeRuntimeError> {
  const a = buildPayload(action, args, callback != null);
  return Result.try({
    try: (): void => {
      if (callback) {
        // sendMessage reports most failures ("Receiving end does not exist",
        // "message port closed") asynchronously via lastError, which
        // Result.try's synchronous catch never sees. Reading it here routes the
        // failure through reportError and silences Chrome's "Unchecked
        // runtime.lastError" warning.
        chrome.runtime.sendMessage(a, (response: R) => {
          if (chrome.runtime.lastError) {
            // Pass message, not the object: formatMessage stringifies the cause,
            // turning { message } into "[object Object]".
            reportError(
              chromeRuntimeError(
                `sendMessage:${action}`,
                chrome.runtime.lastError.message ?? "unknown error",
              ),
            );
            return;
          }
          callback(response);
        });
      } else {
        chrome.runtime.sendMessage(a);
      }
    },
    catch: (cause) => chromeRuntimeError(`sendMessage:${action}`, cause),
  });
};

/**
 * Call background `action` with `args` and resolve with its response.
 *
 * @throws A {@link ChromeRuntimeError} when the background cannot be reached.
 */
function request<R = unknown>(action: string, args?: Record<string, unknown>): Promise<R> {
  const a = buildPayload(action, args, true);
  return new Promise<R>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(a, (response: R) => {
        if (chrome.runtime.lastError) {
          reject(
            chromeRuntimeError(
              `sendMessage:${action}`,
              chrome.runtime.lastError.message ?? "unknown error",
            ),
          );
          return;
        }
        resolve(response);
      });
    } catch (error) {
      // A throw inside the executor rejects with the raw value, which would hand
      // the caller's rejection handler something reportError cannot format.
      reject(chromeRuntimeError(`sendMessage:${action}`, error));
    }
  });
}

type MessageHandler = (
  // Dispatch registry: handlers narrow the message themselves; a shared `unknown` parameter would
  // reject handlers declared with their own concrete message type (contravariance).
  // eslint-disable-next-line typescript/no-explicit-any
  msg: any,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => void;

const handlers: Record<string, MessageHandler> = {};

const getTopURLPromise = new Promise<string>((resolve) => {
  if (window === top) {
    resolve(window.location.href);
  } else {
    RUNTIME("getTopURL", null, (response: { url: string }) => {
      resolve(response.url);
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, response) => {
  handlers[msg.subject]?.(msg, sender, response);
});

const runtime = {
  conf,
  on(message: string, cb: MessageHandler): void {
    handlers[message] = cb;
  },
  bookMessage(message: string, cb: MessageHandler): boolean {
    if (handlers[message]) {
      return false;
    }
    handlers[message] = cb;
    return true;
  },
  releaseMessage(message: string): void {
    delete handlers[message];
  },
  getTopURL(cb: (url: string) => void): void {
    getTopURLPromise.then(cb);
  },
  postTopMessage(msg: unknown): void {
    getTopURLPromise.then((topUrl) => {
      if (window === top) {
        // Firefox use "resource://pdf.js" as window.origin for pdf viewer
        topUrl = window.location.origin;
      }
      if (topUrl === "null" || new URL(topUrl).origin === "file://") {
        topUrl = "*";
      }
      top!.postMessage(msg, topUrl);
    });
  },
  getCaseSensitive,
};

export { request, RUNTIME, runtime };
