import { Result } from "@praha/byethrow";
import { type ChromeRuntimeError, chromeRuntimeError } from "@sk/common/result";

import { conf, getCaseSensitive } from "./conf";
import { repeatCount } from "./repeatCount";
import { reportError } from "./report";

// This module is the messaging service. It deliberately keeps the raw,
// callback-based chrome.runtime API rather than the promise-based
// BrowserAdapter: RUNTIME is used fire-and-forget (no callback) in many places,
// and the polyfill's promise form would turn every such call's
// "message port closed" into an unhandled rejection. onMessage stays here too
// for the same callback contract.

type RuntimeFn = {
  <R = unknown>(
    action: string,
    args?: Record<string, unknown> | null,
    callback?: (response: R) => void,
  ): Result.Result<void, ChromeRuntimeError>;
};

/**
 * Call background `action` with `args`, the `callback` will be executed with response from
 * background. Returns a `Result` so callers decide whether to surface failure to the user.
 *
 * @example
 *   RUNTIME("getTabs", { queryInfo: { currentWindow: true } }, (response) => {
 *     console.log(response);
 *   });
 *
 * @param {string} action A background action to be called.
 * @param {object} args The parameters to be passed to the background action.
 * @param {function} callback A function to be executed with the result from the background action.
 */
const RUNTIME = function (
  action: string,
  args?: Record<string, unknown> | null,
  callback?: (response: unknown) => void,
): Result.Result<void, ChromeRuntimeError> {
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
  const a: Record<string, unknown> = args || {};
  a["action"] = action;
  if (actionsRepeatBackground.includes(action)) {
    // if the action can only be repeated in background, pass repeats to background with args,
    // and set repeatCount.value 1, so that it won't be repeated in foreground's _handleMapKey
    a["repeats"] = repeatCount.value;
    repeatCount.value = 1;
  }
  return Result.try({
    try: (): void => {
      a["needResponse"] = callback != null;
      if (callback) {
        // sendMessage reports most failures ("Receiving end does not exist",
        // "message port closed") asynchronously via lastError, which
        // Result.try's synchronous catch never sees. Reading it here routes the
        // failure through reportError and silences Chrome's "Unchecked
        // runtime.lastError" warning.
        chrome.runtime.sendMessage(a, (response: unknown) => {
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
} as RuntimeFn;

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
    RUNTIME("getTopURL", null, (rs: { url: string }) => {
      resolve(rs.url);
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

export { RUNTIME, runtime };
